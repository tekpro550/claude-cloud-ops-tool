// cloud-ops-tool server agent: a small long-running process that reports
// CPU/memory/disk usage to a monitors.monitor_type='server_agent' monitor via
// POST /agent/report on an interval, authenticated with a long-lived device
// token issued by POST /agent-tokens (see docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md
// section 4). No third-party dependencies -- metrics come from /proc on Linux
// (the only supported target, see metrics_linux.go), and the HTTP client is
// net/http, so this builds and runs with nothing but the Go toolchain.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type report struct {
	CPUPercent  *float64 `json:"cpuPercent,omitempty"`
	MemPercent  *float64 `json:"memPercent,omitempty"`
	DiskPercent *float64 `json:"diskPercent,omitempty"`
}

func main() {
	baseURL := strings.TrimSuffix(requireEnv("AGENT_API_BASE_URL"), "/")
	token := requireEnv("AGENT_TOKEN")
	interval := envDurationSeconds("AGENT_REPORT_INTERVAL_SECONDS", 60)
	diskPath := envString("AGENT_DISK_PATH", "/")
	cpuWindow := envDurationSeconds("AGENT_CPU_SAMPLE_WINDOW_SECONDS", 1)

	client := &http.Client{Timeout: 10 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("cloud-ops-tool agent starting: reporting to %s every %s", baseURL, interval)

	runOnce(ctx, client, baseURL, token, diskPath, cpuWindow)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down")
			return
		case <-ticker.C:
			runOnce(ctx, client, baseURL, token, diskPath, cpuWindow)
		}
	}
}

func runOnce(ctx context.Context, client *http.Client, baseURL, token, diskPath string, cpuWindow time.Duration) {
	rep := report{}
	var errs []string

	if v, err := cpuPercent(cpuWindow); err != nil {
		errs = append(errs, fmt.Sprintf("cpu: %v", err))
	} else {
		rep.CPUPercent = &v
	}
	if v, err := memPercent(); err != nil {
		errs = append(errs, fmt.Sprintf("mem: %v", err))
	} else {
		rep.MemPercent = &v
	}
	if v, err := diskPercent(diskPath); err != nil {
		errs = append(errs, fmt.Sprintf("disk: %v", err))
	} else {
		rep.DiskPercent = &v
	}

	if len(errs) > 0 {
		log.Printf("metrics collection had errors, continuing with what succeeded: %s", strings.Join(errs, "; "))
	}

	if rep.CPUPercent == nil && rep.MemPercent == nil && rep.DiskPercent == nil {
		// Nothing collected at all -- still tell the server we're alive so a
		// metrics bug doesn't masquerade as a genuinely unreachable server.
		if err := post(ctx, client, baseURL+"/agent/heartbeat", token, nil); err != nil {
			log.Printf("heartbeat failed: %v", err)
		}
		return
	}

	if err := post(ctx, client, baseURL+"/agent/report", token, rep); err != nil {
		log.Printf("report failed: %v", err)
	}
}

func post(ctx context.Context, client *http.Client, url, token string, body interface{}) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s returned status %d", url, resp.StatusCode)
	}
	return nil
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("%s is required", key)
	}
	return v
}

func envString(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDurationSeconds(key string, def int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return time.Duration(def) * time.Second
}
