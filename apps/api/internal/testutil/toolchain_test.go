package testutil

import (
	"regexp"
	"runtime"
	"strconv"
	"testing"
)

var goReleaseVersionPattern = regexp.MustCompile(`^go(\d+)\.(\d+)(?:\.(\d+))?`)

func TestRequiresPatchedGoToolchain(t *testing.T) {
	t.Parallel()

	major, minor, patch, ok := parseGoReleaseVersion(runtime.Version())
	if !ok {
		t.Skipf("skipping toolchain guard for non-release Go version %q", runtime.Version())
	}

	if major > 1 || (major == 1 && minor > 26) {
		return
	}

	if major == 1 && minor == 26 && patch < 2 {
		t.Fatalf(
			"Go toolchain %q is below the minimum patched version go1.26.2 required by the security audit",
			runtime.Version(),
		)
	}
}

func parseGoReleaseVersion(version string) (int, int, int, bool) {
	matches := goReleaseVersionPattern.FindStringSubmatch(version)
	if matches == nil {
		return 0, 0, 0, false
	}

	major, err := strconv.Atoi(matches[1])
	if err != nil {
		return 0, 0, 0, false
	}

	minor, err := strconv.Atoi(matches[2])
	if err != nil {
		return 0, 0, 0, false
	}

	patch := 0
	if matches[3] != "" {
		patch, err = strconv.Atoi(matches[3])
		if err != nil {
			return 0, 0, 0, false
		}
	}

	return major, minor, patch, true
}
