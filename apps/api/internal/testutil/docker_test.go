package testutil

import "testing"

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
