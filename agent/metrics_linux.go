//go:build linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// cpuSample is a snapshot of /proc/stat's aggregate "cpu" line -- CPU percent
// is a delta over a short window, not an instantaneous value, so callers take
// two samples a moment apart.
type cpuSample struct {
	idle  uint64
	total uint64
}

func readCPUSample() (cpuSample, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuSample{}, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return cpuSample{}, fmt.Errorf("empty /proc/stat")
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuSample{}, fmt.Errorf("unexpected /proc/stat format: %q", scanner.Text())
	}

	var total uint64
	var idle uint64
	for i, field := range fields[1:] {
		v, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuSample{}, err
		}
		total += v
		if i == 3 { // idle is the 4th value (user, nice, system, idle, ...)
			idle = v
		}
	}
	return cpuSample{idle: idle, total: total}, nil
}

// cpuPercent samples /proc/stat twice across `window` and returns the
// percentage of non-idle time in between -- the standard /proc/stat approach
// since it has no single-shot "current CPU usage" figure.
func cpuPercent(window time.Duration) (float64, error) {
	first, err := readCPUSample()
	if err != nil {
		return 0, err
	}
	time.Sleep(window)
	second, err := readCPUSample()
	if err != nil {
		return 0, err
	}

	totalDelta := second.total - first.total
	idleDelta := second.idle - first.idle
	if totalDelta == 0 {
		return 0, nil
	}
	return 100 * (1 - float64(idleDelta)/float64(totalDelta)), nil
}

func memPercent() (float64, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	defer f.Close()

	values := map[string]uint64{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := line[:colon]
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		fields := strings.Fields(line[colon+1:])
		if len(fields) == 0 {
			continue
		}
		v, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		values[key] = v
	}

	total, ok := values["MemTotal"]
	if !ok || total == 0 {
		return 0, fmt.Errorf("MemTotal not found in /proc/meminfo")
	}
	available, ok := values["MemAvailable"]
	if !ok {
		return 0, fmt.Errorf("MemAvailable not found in /proc/meminfo")
	}
	return 100 * (1 - float64(available)/float64(total)), nil
}

func diskPercent(path string) (float64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	if total == 0 {
		return 0, fmt.Errorf("statfs reported zero total blocks for %s", path)
	}
	return 100 * (1 - float64(free)/float64(total)), nil
}
