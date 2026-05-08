//go:build mage

package main

import (
	// mage:import
	build "github.com/grafana/grafana-plugin-sdk-go/build"
)

// Default target: build for the current platform.
var Default = build.BuildAll
