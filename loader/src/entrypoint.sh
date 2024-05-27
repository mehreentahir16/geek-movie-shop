#!/bin/sh

if [ -z "$CLIENTS" ]; then
  CLIENTS=1
fi

if [ -z "$HOST" ]; then
  echo "Error: HOST environment variable is not set."
  exit 1
fi

locust -f loader.py --host "$HOST" --headless -u $CLIENTS -r 0.001