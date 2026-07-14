//go:build !linux

package main

import (
	"fmt"
	"time"
)

// The production target is Linux servers (see docs/deployment-oracle-cloud.md),
// so metrics collection is only implemented via /proc on Linux (metrics_linux.go).
// This build tag keeps `go build`/`go run` working on a developer's Mac/Windows
// machine without pulling in a third-party cross-platform metrics library.
func cpuPercent(_ time.Duration) (float64, error) {
	return 0, fmt.Errorf("cpu metrics are only implemented for linux")
}

func memPercent() (float64, error) {
	return 0, fmt.Errorf("memory metrics are only implemented for linux")
}

func diskPercent(_ string) (float64, error) {
	return 0, fmt.Errorf("disk metrics are only implemented for linux")
}
