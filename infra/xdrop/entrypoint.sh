#!/bin/sh
set -eu

api_addr="${API_ADDR:-:8080}"
default_api_upstream="${api_addr}"
case "${default_api_upstream}" in
  *://*)
    ;;
  :*)
    default_api_upstream="http://127.0.0.1${default_api_upstream}"
    ;;
  *)
    default_api_upstream="http://${default_api_upstream}"
    ;;
esac

default_s3_proxy_target="${S3_ENDPOINT:-http://minio:9000}"
case "${default_s3_proxy_target}" in
  *://*)
    ;;
  *)
  default_s3_proxy_target="http://${default_s3_proxy_target}"
    ;;
esac

export API_UPSTREAM="${API_UPSTREAM:-${default_api_upstream}}"
export S3_PROXY_TARGET="${S3_PROXY_TARGET:-${default_s3_proxy_target}}"

envsubst '${API_UPSTREAM} ${S3_PROXY_TARGET}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

/usr/local/bin/xdrop-api &
api_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

shutdown() {
  if kill -0 "${api_pid}" 2>/dev/null; then
    kill "${api_pid}" 2>/dev/null || true
  fi

  if kill -0 "${nginx_pid}" 2>/dev/null; then
    kill "${nginx_pid}" 2>/dev/null || true
  fi

  wait "${api_pid}" 2>/dev/null || true
  wait "${nginx_pid}" 2>/dev/null || true
}

trap 'shutdown; exit 0' INT TERM

status=0
while kill -0 "${api_pid}" 2>/dev/null && kill -0 "${nginx_pid}" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "${api_pid}" 2>/dev/null; then
  wait "${api_pid}" || status=$?
elif ! kill -0 "${nginx_pid}" 2>/dev/null; then
  wait "${nginx_pid}" || status=$?
fi

shutdown
exit "${status}"
