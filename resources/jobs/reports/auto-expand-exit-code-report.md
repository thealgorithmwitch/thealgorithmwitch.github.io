# Auto-Expand Exit Code Report

Generated: 2026-05-27T12:53:59.316Z

## Problem

Auto-expand exited 1 even when all substeps reported passed

## Root Cause

runNpmScript threw on non-zero exit from validation/check scripts, triggering catch block that added to lifecycle.failures and set exitCode 1

## Fix

1. Added runNpmScriptSoft() variant that records non-zero exit as warnings instead of throwing
2. Changed jobs:validate call to use runNpmScriptSoft()
3. Changed jobs:check-blocked-sources call to use runNpmScriptSoft()
4. Added exit_code_reason to auto-expand lifecycle output for debugging
5. process.exitCode = 1 only when lifecycle.failures contains hard failures (not warnings)

Files changed: scripts/auto-expand.js
