package testutil

import (
	"context"
	"fmt"
	"io"
	"net"
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

type DockerRunRequest struct {
	NamePrefix   string
	Image        string
	Env          map[string]string
	ExposedPorts []string
	Command      []string
}

type DockerContainer struct {
	name string
}

func SkipIfDockerUnavailable(t *testing.T, skipOnWindows bool) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping docker-backed integration test in short mode")
	}
	if skipOnWindows && runtime.GOOS == "windows" {
		t.Skip("skipping docker-backed integration test on windows")
	}

	cmd := exec.Command("docker", "info")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		t.Skipf("skipping docker-backed integration test: %v", err)
	}
}

func StartDockerContainer(t *testing.T, ctx context.Context, request DockerRunRequest) *DockerContainer {
	t.Helper()

	name := uniqueContainerName(request.NamePrefix)
	args := []string{"run", "-d", "--rm", "--name", name}

	if len(request.Env) > 0 {
		keys := make([]string, 0, len(request.Env))
		for key := range request.Env {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			args = append(args, "-e", fmt.Sprintf("%s=%s", key, request.Env[key]))
		}
	}

	for _, port := range request.ExposedPorts {
		containerPort := strings.TrimSuffix(port, "/tcp")
		args = append(args, "-p", fmt.Sprintf("127.0.0.1::%s", containerPort))
	}

	args = append(args, request.Image)
	args = append(args, request.Command...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("docker run failed: %v\n%s", err, strings.TrimSpace(string(output)))
	}

	container := &DockerContainer{name: name}
	t.Cleanup(func() {
		terminateCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := container.Terminate(terminateCtx); err != nil {
			t.Fatalf("failed to terminate docker container %s: %v", name, err)
		}
	})

	return container
}

func (container *DockerContainer) PublishedPort(t *testing.T, ctx context.Context, port string) string {
	t.Helper()

	cmd := exec.CommandContext(ctx, "docker", "port", container.name, port)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("docker port failed: %v\n%s", err, strings.TrimSpace(string(output)))
	}

	publishedPort, err := parsePublishedPort(string(output))
	if err != nil {
		t.Fatalf("failed to parse published port for %s: %v", port, err)
	}

	return publishedPort
}

func (container *DockerContainer) Terminate(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "rm", "-f", container.name)
	output, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if strings.Contains(trimmed, "No such container") {
			return nil
		}
		return fmt.Errorf("docker rm -f %s: %w: %s", container.name, err, trimmed)
	}

	return nil
}

func WaitForCondition(ctx context.Context, timeout time.Duration, interval time.Duration, check func() error) error {
	deadline := time.Now().Add(timeout)
	var lastErr error

	for {
		if err := check(); err == nil {
			return nil
		} else {
			lastErr = err
		}

		if time.Now().After(deadline) {
			break
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("condition did not become ready")
	}

	return fmt.Errorf("timed out waiting for condition: %w", lastErr)
}

func parsePublishedPort(output string) (string, error) {
	line := strings.TrimSpace(output)
	if line == "" {
		return "", fmt.Errorf("empty docker port output")
	}

	if newline := strings.Index(line, "\n"); newline >= 0 {
		line = line[:newline]
	}

	if _, port, err := net.SplitHostPort(line); err == nil {
		return port, nil
	}

	lastColon := strings.LastIndex(line, ":")
	if lastColon >= 0 && lastColon < len(line)-1 {
		return line[lastColon+1:], nil
	}

	return "", fmt.Errorf("unexpected docker port output %q", output)
}

func uniqueContainerName(prefix string) string {
	cleanPrefix := strings.TrimSpace(prefix)
	if cleanPrefix == "" {
		cleanPrefix = "xdrop-test"
	}

	return fmt.Sprintf("%s-%d", cleanPrefix, time.Now().UnixNano())
}
