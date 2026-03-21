package storage

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/stretchr/testify/require"
)

func TestNewS3StoragePresignsAgainstConfiguredEndpoints(t *testing.T) {
	ctx := context.Background()
	store, err := NewS3Storage(ctx, Config{
		Endpoint:       "http://internal.example.test:9000",
		PublicEndpoint: "http://public.example.test:9000",
		Region:         "us-east-1",
		Bucket:         "xdrop",
		AccessKey:      "key",
		SecretKey:      "secret",
	})
	require.NoError(t, err)

	uploadURL, err := store.PresignUpload(ctx, "transfers/demo/object.bin", time.Minute)
	require.NoError(t, err)
	require.Contains(t, uploadURL, "public.example.test:9000")

	downloadURL, err := store.PresignDownload(ctx, "transfers/demo/object.bin", time.Minute)
	require.NoError(t, err)
	require.Contains(t, downloadURL, "public.example.test:9000")

	internalStore, err := NewS3Storage(ctx, Config{
		Endpoint:  "http://internal.example.test:9000",
		Region:    "us-east-1",
		Bucket:    "xdrop",
		AccessKey: "key",
		SecretKey: "secret",
	})
	require.NoError(t, err)

	uploadURL, err = internalStore.PresignUpload(ctx, "transfers/demo/object.bin", time.Minute)
	require.NoError(t, err)
	require.Contains(t, uploadURL, "internal.example.test:9000")

	t.Run("surfaces aws config load failures", func(t *testing.T) {
		originalLoader := loadDefaultAWSConfig
		t.Cleanup(func() {
			loadDefaultAWSConfig = originalLoader
		})
		loadDefaultAWSConfig = func(context.Context, ...func(*awsconfig.LoadOptions) error) (aws.Config, error) {
			return aws.Config{}, errors.New("boom")
		}

		_, err := NewS3Storage(ctx, Config{
			Endpoint:  "http://internal.example.test:9000",
			Region:    "us-east-1",
			Bucket:    "xdrop",
			AccessKey: "key",
			SecretKey: "secret",
		})
		require.ErrorContains(t, err, "load aws config")
	})

	t.Run("surfaces public aws config load failures", func(t *testing.T) {
		originalLoader := loadDefaultAWSConfig
		t.Cleanup(func() {
			loadDefaultAWSConfig = originalLoader
		})
		callCount := 0
		loadDefaultAWSConfig = func(innerCtx context.Context, opts ...func(*awsconfig.LoadOptions) error) (aws.Config, error) {
			callCount++
			if callCount == 2 {
				return aws.Config{}, errors.New("boom")
			}
			return originalLoader(innerCtx, opts...)
		}

		_, err := NewS3Storage(ctx, Config{
			Endpoint:       "http://internal.example.test:9000",
			PublicEndpoint: "http://public.example.test:9000",
			Region:         "us-east-1",
			Bucket:         "xdrop",
			AccessKey:      "key",
			SecretKey:      "secret",
		})
		require.ErrorContains(t, err, "load public aws config")
	})

	t.Run("initializes the default paginator factory", func(t *testing.T) {
		t.Parallel()

		store, err := NewS3Storage(ctx, Config{
			Endpoint:  "http://internal.example.test:9000",
			Region:    "us-east-1",
			Bucket:    "xdrop",
			AccessKey: "key",
			SecretKey: "secret",
		})
		require.NoError(t, err)
		require.NotNil(t, store.paginator)
		require.NotNil(t, store.paginator(store.client, &s3.ListObjectsV2Input{
			Bucket: aws.String("xdrop"),
		}))
	})
}

func TestS3StorageEnsureBucket(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("head bucket success", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				headBucketFn: func(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
					return &s3.HeadBucketOutput{}, nil
				},
			},
		}

		require.NoError(t, store.EnsureBucket(ctx))
	})

	t.Run("create bucket on missing bucket", func(t *testing.T) {
		createCalls := 0
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				headBucketFn: func(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
					return nil, errors.New("missing")
				},
				createBucketFn: func(context.Context, *s3.CreateBucketInput, ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
					createCalls++
					return &s3.CreateBucketOutput{}, nil
				},
			},
		}

		require.NoError(t, store.EnsureBucket(ctx))
		require.Equal(t, 1, createCalls)
	})

	t.Run("bucket already owned is ignored", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				headBucketFn: func(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
					return nil, errors.New("missing")
				},
				createBucketFn: func(context.Context, *s3.CreateBucketInput, ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
					return nil, errors.New("BucketAlreadyOwnedByYou")
				},
			},
		}

		require.NoError(t, store.EnsureBucket(ctx))
	})

	t.Run("create bucket failure", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				headBucketFn: func(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
					return nil, errors.New("missing")
				},
				createBucketFn: func(context.Context, *s3.CreateBucketInput, ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
					return nil, errors.New("boom")
				},
			},
		}

		err := store.EnsureBucket(ctx)
		require.ErrorContains(t, err, "create bucket")
	})
}

func TestS3StoragePresignAndUploadOperations(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("presign upload success and error", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			presigner: fakePresigner{
				presignPutObjectFn: func(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
					return &v4.PresignedHTTPRequest{URL: "http://upload.example.test"}, nil
				},
			},
		}

		url, err := store.PresignUpload(ctx, "object.bin", time.Minute)
		require.NoError(t, err)
		require.Equal(t, "http://upload.example.test", url)

		store.presigner = fakePresigner{
			presignPutObjectFn: func(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
				return nil, errors.New("boom")
			},
		}
		_, err = store.PresignUpload(ctx, "object.bin", time.Minute)
		require.ErrorContains(t, err, "presign upload")
	})

	t.Run("presign download success and error", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			presigner: fakePresigner{
				presignGetObjectFn: func(context.Context, *s3.GetObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
					return &v4.PresignedHTTPRequest{URL: "http://download.example.test"}, nil
				},
			},
		}

		url, err := store.PresignDownload(ctx, "object.bin", time.Minute)
		require.NoError(t, err)
		require.Equal(t, "http://download.example.test", url)

		store.presigner = fakePresigner{
			presignGetObjectFn: func(context.Context, *s3.GetObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
				return nil, errors.New("boom")
			},
		}
		_, err = store.PresignDownload(ctx, "object.bin", time.Minute)
		require.ErrorContains(t, err, "presign download")
	})

	t.Run("put object success and error", func(t *testing.T) {
		body := []byte("payload")
		store := S3Storage{
			bucket: "xdrop",
			uploader: fakeUploader{
				uploadFn: func(_ context.Context, input *s3.PutObjectInput, _ ...func(*manager.Uploader)) (*manager.UploadOutput, error) {
					uploaded, err := io.ReadAll(input.Body)
					require.NoError(t, err)
					require.Equal(t, body, uploaded)
					require.Equal(t, "application/octet-stream", aws.ToString(input.ContentType))
					return &manager.UploadOutput{}, nil
				},
			},
		}

		require.NoError(t, store.PutObject(ctx, "object.bin", body, "application/octet-stream"))

		store.uploader = fakeUploader{
			uploadFn: func(context.Context, *s3.PutObjectInput, ...func(*manager.Uploader)) (*manager.UploadOutput, error) {
				return nil, errors.New("boom")
			},
		}
		err := store.PutObject(ctx, "object.bin", body, "application/octet-stream")
		require.ErrorContains(t, err, "upload object")
	})
}

func TestS3StorageDeletePrefix(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("list error", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{},
			paginator: func(s3.ListObjectsV2APIClient, *s3.ListObjectsV2Input) listObjectsV2Paginator {
				return &fakePaginator{nextPageErr: errors.New("boom"), remaining: 1}
			},
		}

		err := store.DeletePrefix(ctx, "transfers/demo/")
		require.ErrorContains(t, err, "list objects")
	})

	t.Run("delete error", func(t *testing.T) {
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				deleteObjectsFn: func(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
					return nil, errors.New("boom")
				},
			},
			paginator: func(s3.ListObjectsV2APIClient, *s3.ListObjectsV2Input) listObjectsV2Paginator {
				return &fakePaginator{
					pages: []*s3.ListObjectsV2Output{{
						Contents: []s3types.Object{{Key: aws.String("transfers/demo/one.bin")}},
					}},
					remaining: 1,
				}
			},
		}

		err := store.DeletePrefix(ctx, "transfers/demo/")
		require.ErrorContains(t, err, "delete objects")
	})

	t.Run("success skips empty pages and nil keys", func(t *testing.T) {
		deletedKeys := []string{}
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				deleteObjectsFn: func(_ context.Context, input *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
					for _, object := range input.Delete.Objects {
						deletedKeys = append(deletedKeys, aws.ToString(object.Key))
					}
					return &s3.DeleteObjectsOutput{}, nil
				},
			},
			paginator: func(s3.ListObjectsV2APIClient, *s3.ListObjectsV2Input) listObjectsV2Paginator {
				return &fakePaginator{
					pages: []*s3.ListObjectsV2Output{
						{},
						{
							Contents: []s3types.Object{
								{},
								{Key: aws.String("transfers/demo/one.bin")},
								{Key: aws.String("transfers/demo/two.bin")},
							},
						},
					},
					remaining: 2,
				}
			},
		}

		require.NoError(t, store.DeletePrefix(ctx, "transfers/demo/"))
		require.Equal(t, []string{"transfers/demo/one.bin", "transfers/demo/two.bin"}, deletedKeys)
	})

	t.Run("skips delete calls when a page only has nil keys", func(t *testing.T) {
		deleteCalls := 0
		store := S3Storage{
			bucket: "xdrop",
			client: fakeS3Client{
				deleteObjectsFn: func(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
					deleteCalls++
					return &s3.DeleteObjectsOutput{}, nil
				},
			},
			paginator: func(s3.ListObjectsV2APIClient, *s3.ListObjectsV2Input) listObjectsV2Paginator {
				return &fakePaginator{
					pages: []*s3.ListObjectsV2Output{{
						Contents: []s3types.Object{{}},
					}},
					remaining: 1,
				}
			},
		}

		require.NoError(t, store.DeletePrefix(ctx, "transfers/demo/"))
		require.Zero(t, deleteCalls)
	})
}

type fakeS3Client struct {
	createBucketFn  func(ctx context.Context, params *s3.CreateBucketInput, optFns ...func(*s3.Options)) (*s3.CreateBucketOutput, error)
	deleteObjectsFn func(ctx context.Context, params *s3.DeleteObjectsInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
	getObjectFn     func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	headBucketFn    func(ctx context.Context, params *s3.HeadBucketInput, optFns ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
	listObjectsFn   func(ctx context.Context, params *s3.ListObjectsV2Input, optFns ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
}

func (c fakeS3Client) CreateBucket(ctx context.Context, params *s3.CreateBucketInput, optFns ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
	if c.createBucketFn != nil {
		return c.createBucketFn(ctx, params, optFns...)
	}
	return &s3.CreateBucketOutput{}, nil
}

func (c fakeS3Client) DeleteObjects(ctx context.Context, params *s3.DeleteObjectsInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	if c.deleteObjectsFn != nil {
		return c.deleteObjectsFn(ctx, params, optFns...)
	}
	return &s3.DeleteObjectsOutput{}, nil
}

func (c fakeS3Client) GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	if c.getObjectFn != nil {
		return c.getObjectFn(ctx, params, optFns...)
	}
	return &s3.GetObjectOutput{}, nil
}

func (c fakeS3Client) HeadBucket(ctx context.Context, params *s3.HeadBucketInput, optFns ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	if c.headBucketFn != nil {
		return c.headBucketFn(ctx, params, optFns...)
	}
	return &s3.HeadBucketOutput{}, nil
}

func (c fakeS3Client) ListObjectsV2(ctx context.Context, params *s3.ListObjectsV2Input, optFns ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	if c.listObjectsFn != nil {
		return c.listObjectsFn(ctx, params, optFns...)
	}
	return &s3.ListObjectsV2Output{}, nil
}

type fakePresigner struct {
	presignGetObjectFn func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
	presignPutObjectFn func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

func (p fakePresigner) PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	if p.presignGetObjectFn != nil {
		return p.presignGetObjectFn(ctx, params, optFns...)
	}
	return &v4.PresignedHTTPRequest{}, nil
}

func (p fakePresigner) PresignPutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	if p.presignPutObjectFn != nil {
		return p.presignPutObjectFn(ctx, params, optFns...)
	}
	return &v4.PresignedHTTPRequest{}, nil
}

type fakeUploader struct {
	uploadFn func(ctx context.Context, input *s3.PutObjectInput, opts ...func(*manager.Uploader)) (*manager.UploadOutput, error)
}

func (u fakeUploader) Upload(ctx context.Context, input *s3.PutObjectInput, opts ...func(*manager.Uploader)) (*manager.UploadOutput, error) {
	if u.uploadFn != nil {
		return u.uploadFn(ctx, input, opts...)
	}
	return &manager.UploadOutput{}, nil
}

type fakePaginator struct {
	nextPageErr error
	pages       []*s3.ListObjectsV2Output
	remaining   int
}

func (p *fakePaginator) HasMorePages() bool {
	return p.remaining > 0
}

func (p *fakePaginator) NextPage(context.Context, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	if p.nextPageErr != nil {
		return nil, p.nextPageErr
	}
	page := p.pages[0]
	p.pages = p.pages[1:]
	p.remaining--
	return page, nil
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, errors.New("boom")
}

func TestReadAllPropagatesReaderErrors(t *testing.T) {
	t.Parallel()

	_, err := ReadAll(errReader{})
	require.ErrorContains(t, err, "boom")
}
