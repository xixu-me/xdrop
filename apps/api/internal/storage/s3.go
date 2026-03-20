package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ObjectStorage defines the storage operations the service layer needs for transfer objects.
type ObjectStorage interface {
	PresignUpload(ctx context.Context, objectKey string, ttl time.Duration) (string, error)
	PresignDownload(ctx context.Context, objectKey string, ttl time.Duration) (string, error)
	PutObject(ctx context.Context, objectKey string, body []byte, contentType string) error
	DeletePrefix(ctx context.Context, prefix string) error
	EnsureBucket(ctx context.Context) error
}

type s3Client interface {
	s3.ListObjectsV2APIClient
	CreateBucket(ctx context.Context, params *s3.CreateBucketInput, optFns ...func(*s3.Options)) (*s3.CreateBucketOutput, error)
	DeleteObjects(ctx context.Context, params *s3.DeleteObjectsInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
	GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	HeadBucket(ctx context.Context, params *s3.HeadBucketInput, optFns ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
}

type s3Presigner interface {
	PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
	PresignPutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

type s3Uploader interface {
	Upload(ctx context.Context, input *s3.PutObjectInput, opts ...func(*manager.Uploader)) (*manager.UploadOutput, error)
}

type listObjectsV2Paginator interface {
	HasMorePages() bool
	NextPage(ctx context.Context, optFns ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
}

// S3Storage stores transfer objects in an S3-compatible bucket.
type S3Storage struct {
	bucket    string
	client    s3Client
	presigner s3Presigner
	uploader  s3Uploader
	paginator func(client s3.ListObjectsV2APIClient, input *s3.ListObjectsV2Input) listObjectsV2Paginator
}

// Config describes how to connect to the private and public S3-compatible endpoints.
type Config struct {
	Endpoint       string
	PublicEndpoint string
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
	UseSSL         bool
}

var loadDefaultAWSConfig = awsconfig.LoadDefaultConfig

// NewS3Storage builds an S3-backed object storage adapter with optional public presign endpoint.
func NewS3Storage(ctx context.Context, cfg Config) (*S3Storage, error) {
	endpoint := cfg.Endpoint
	awsCfg, err := loadDefaultAWSConfig(
		ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
		awsconfig.WithBaseEndpoint(endpoint),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.UsePathStyle = true
	})
	presignClient := client

	if cfg.PublicEndpoint != "" && cfg.PublicEndpoint != cfg.Endpoint {
		publicCfg, configErr := loadDefaultAWSConfig(
			ctx,
			awsconfig.WithRegion(cfg.Region),
			awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
			awsconfig.WithBaseEndpoint(cfg.PublicEndpoint),
		)
		if configErr != nil {
			return nil, fmt.Errorf("load public aws config: %w", configErr)
		}
		presignClient = s3.NewFromConfig(publicCfg, func(options *s3.Options) {
			options.UsePathStyle = true
		})
	}

	return &S3Storage{
		bucket:    cfg.Bucket,
		client:    client,
		presigner: s3.NewPresignClient(presignClient),
		uploader:  manager.NewUploader(client),
		paginator: func(client s3.ListObjectsV2APIClient, input *s3.ListObjectsV2Input) listObjectsV2Paginator {
			return s3.NewListObjectsV2Paginator(client, input)
		},
	}, nil
}

// EnsureBucket creates the bucket if it does not already exist.
func (s *S3Storage) EnsureBucket(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err == nil {
		return nil
	}

	_, err = s.client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(s.bucket),
	})
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "bucketalreadyownedbyyou") {
		return fmt.Errorf("create bucket: %w", err)
	}

	return nil
}

// PresignUpload returns a time-limited PUT URL for one object key.
func (s *S3Storage) PresignUpload(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	result, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign upload: %w", err)
	}

	return result.URL, nil
}

// PresignDownload returns a time-limited GET URL for one object key.
func (s *S3Storage) PresignDownload(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	result, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign download: %w", err)
	}

	return result.URL, nil
}

// PutObject uploads a complete object payload with the provided content type.
func (s *S3Storage) PutObject(ctx context.Context, objectKey string, body []byte, contentType string) error {
	reader := bytes.NewReader(body)

	_, err := s.uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(objectKey),
		Body:        reader,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("upload object: %w", err)
	}

	return nil
}

// DeletePrefix removes every object currently stored beneath a transfer prefix.
func (s *S3Storage) DeletePrefix(ctx context.Context, prefix string) error {
	paginator := s.paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list objects: %w", err)
		}

		if len(page.Contents) == 0 {
			continue
		}

		objects := make([]s3typesObjectIdentifier, 0, len(page.Contents))
		for _, item := range page.Contents {
			if item.Key == nil {
				continue
			}
			objects = append(objects, s3typesObjectIdentifier{Key: item.Key})
		}

		if len(objects) == 0 {
			continue
		}

		deleteObjects := make([]s3types.ObjectIdentifier, 0, len(objects))
		for _, object := range objects {
			deleteObjects = append(deleteObjects, s3types.ObjectIdentifier{Key: object.Key})
		}

		_, err = s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &s3types.Delete{Objects: deleteObjects},
		})
		if err != nil {
			return fmt.Errorf("delete objects: %w", err)
		}
	}

	return nil
}

type s3typesObjectIdentifier struct {
	Key *string
}

// NormalizeEndpoint ensures user-supplied endpoints always parse as full URLs.
func NormalizeEndpoint(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("parse endpoint: %w", err)
	}

	return parsed.String(), nil
}

// ReadAll is kept as a shim so tests can stub object reads without importing io directly.
func ReadAll(reader io.Reader) ([]byte, error) {
	return io.ReadAll(reader)
}
