package testutil

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestParsePublishedPortParsesIPv4Binding(t *testing.T) {
	t.Parallel()

	port, err := parsePublishedPort("127.0.0.1:49154\n")
	if err != nil {
		t.Fatalf("parsePublishedPort returned error: %v", err)
	}
	if port != "49154" {
		t.Fatalf("parsePublishedPort returned %q, want %q", port, "49154")
	}
}

func TestParsePublishedPortParsesIPv6Binding(t *testing.T) {
	t.Parallel()

	port, err := parsePublishedPort("[::]:32768\n")
	if err != nil {
		t.Fatalf("parsePublishedPort returned error: %v", err)
	}
	if port != "32768" {
		t.Fatalf("parsePublishedPort returned %q, want %q", port, "32768")
	}
}

func TestParsePublishedPortRejectsUnexpectedFormat(t *testing.T) {
	t.Parallel()

	if _, err := parsePublishedPort("not-a-port"); err == nil {
		t.Fatal("parsePublishedPort succeeded for malformed output")
	}
}

func TestParsePublishedPortUsesTheFirstLineFromMultiLineOutput(t *testing.T) {
	t.Parallel()

	port, err := parsePublishedPort("127.0.0.1:49154\n[::]:32768\n")
	if err != nil {
		t.Fatalf("parsePublishedPort returned error: %v", err)
	}
	if port != "49154" {
		t.Fatalf("parsePublishedPort returned %q, want %q", port, "49154")
	}
}

func TestWaitForConditionRetriesUntilSuccess(t *testing.T) {
	t.Parallel()

	attempts := 0
	err := WaitForCondition(context.Background(), 50*time.Millisecond, time.Millisecond, func() error {
		attempts++
		if attempts < 3 {
			return errors.New("not yet")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WaitForCondition returned error: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("WaitForCondition attempted %d times, want 3", attempts)
	}
}

func TestWaitForConditionReturnsContextError(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := WaitForCondition(ctx, 50*time.Millisecond, time.Millisecond, func() error {
		return errors.New("still waiting")
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("WaitForCondition returned %v, want context.Canceled", err)
	}
}

func TestWaitForConditionIncludesLastErrorOnTimeout(t *testing.T) {
	t.Parallel()

	err := WaitForCondition(context.Background(), 5*time.Millisecond, time.Millisecond, func() error {
		return errors.New("still failing")
	})
	if err == nil {
		t.Fatal("WaitForCondition succeeded, want timeout error")
	}
	if !strings.Contains(err.Error(), "still failing") {
		t.Fatalf("WaitForCondition returned %q, want to include the last error", err)
	}
}

func TestUniqueContainerNameFallsBackToTheDefaultPrefix(t *testing.T) {
	t.Parallel()

	name := uniqueContainerName("   ")
	if !strings.HasPrefix(name, "xdrop-test-") {
		t.Fatalf("uniqueContainerName returned %q, want default prefix", name)
	}
}
