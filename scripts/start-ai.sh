#!/usr/bin/env bash

set -e

echo "======================================"
echo " Updating AI Development Environment"
echo "======================================"

echo ""
echo "[1/3] Updating Claude Code..."
claude update

echo ""
echo "[2/3] Updating OMC..."
npm install -g oh-my-claude-sisyphus@latest

echo ""
echo "[3/3] Updating Codex..."
npm install -g @openai/codex@latest

echo ""
echo "======================================"
echo " Versions"
echo "======================================"

echo ""
claude --version
omc --version
codex --version

echo ""
echo "======================================"
echo " Starting OMC"
echo "======================================"
echo ""

exec omc