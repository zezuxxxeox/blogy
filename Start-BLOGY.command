#!/bin/bash

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://127.0.0.1:5174"
APP_VERSION="v=26"
LOG_PATH="$PROJECT_DIR/.server.log"
ERR_PATH="$PROJECT_DIR/.server.err.log"
LOCAL_NODE_DIR="$PROJECT_DIR/.local-node"
LOCAL_NODE_BIN="$LOCAL_NODE_DIR/bin/node"

show_message() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"BLOGY\""
  else
    echo "$1"
  fi
}

test_server() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi

  local content
  content="$(curl -fsS --max-time 2 "$URL" 2>/dev/null || true)"
  [[ "$content" == *"<title>BLOGY</title>"* && "$content" == *"$APP_VERSION"* ]]
}

get_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [[ -x "$LOCAL_NODE_BIN" ]]; then
    echo "$LOCAL_NODE_BIN"
    return 0
  fi

  install_local_node
  if [[ -x "$LOCAL_NODE_BIN" ]]; then
    echo "$LOCAL_NODE_BIN"
    return 0
  fi

  return 1
}

install_local_node() {
  if ! command -v curl >/dev/null 2>&1; then
    show_message "BLOGY could not download Node.js because curl is missing.\nInstall Node.js from https://nodejs.org, then open BLOGY again."
    return 1
  fi

  if ! command -v tar >/dev/null 2>&1; then
    show_message "BLOGY could not unpack Node.js because tar is missing.\nInstall Node.js from https://nodejs.org, then open BLOGY again."
    return 1
  fi

  local cpu_arch
  local node_arch
  cpu_arch="$(uname -m)"
  case "$cpu_arch" in
    arm64)
      node_arch="darwin-arm64"
      ;;
    x86_64)
      node_arch="darwin-x64"
      ;;
    *)
      show_message "BLOGY could not detect a supported Mac CPU.\nInstall Node.js from https://nodejs.org, then open BLOGY again."
      return 1
      ;;
  esac

  show_message "Node.js is not installed.\nBLOGY will download a local copy now.\nThis can take a minute."

  local tmp_dir
  local dist_url
  local archive_name
  local archive_path
  tmp_dir="$(mktemp -d)"
  dist_url="https://nodejs.org/dist/latest-v22.x"
  archive_name="$(curl -fsSL "$dist_url/SHASUMS256.txt" | awk -v arch="$node_arch" '$2 ~ arch "\\.tar\\.gz$" { print $2; exit }')"

  if [[ -z "$archive_name" ]]; then
    rm -rf "$tmp_dir"
    show_message "BLOGY could not find the Node.js download.\nInstall Node.js from https://nodejs.org, then open BLOGY again."
    return 1
  fi

  archive_path="$tmp_dir/$archive_name"
  curl -fL "$dist_url/$archive_name" -o "$archive_path"
  tar -xzf "$archive_path" -C "$tmp_dir"
  rm -rf "$LOCAL_NODE_DIR"
  mv "$tmp_dir/${archive_name%.tar.gz}" "$LOCAL_NODE_DIR"
  rm -rf "$tmp_dir"
}

start_server() {
  local node_path
  node_path="$(get_node || true)"
  if [[ -z "$node_path" ]]; then
    exit 1
  fi

  cd "$PROJECT_DIR"
  nohup "$node_path" server.mjs >"$LOG_PATH" 2>"$ERR_PATH" &

  local deadline=$((SECONDS + 10))
  while (( SECONDS < deadline )); do
    if test_server; then
      return 0
    fi
    sleep 0.35
  done
}

open_app() {
  local cache_bust
  cache_bust="$(date +%s)"
  local app_url="$URL/?v=$cache_bust"

  if [[ -d "/Applications/Microsoft Edge.app" ]]; then
    open -na "Microsoft Edge" --args --app="$app_url"
  elif [[ -d "/Applications/Google Chrome.app" ]]; then
    open -na "Google Chrome" --args --app="$app_url"
  else
    open "$app_url"
  fi
}

if ! test_server; then
  start_server
fi

if ! test_server; then
  show_message "BLOGY server could not start.\nCheck .server.err.log in the project folder."
  exit 1
fi

open_app
