#!/usr/bin/env bash
# Runs inside the python:3.11-slim container that convert_model.sh starts: Rockchip's toolkit (the x86_64 build;
# the arm64 one segfaults looking for a real NPU), then convert_model.py. Mounts: /data (model + frames), /out, /scripts.
set -e
apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 > /dev/null
pip install -q --no-cache-dir -r https://raw.githubusercontent.com/airockchip/rknn-toolkit2/master/rknn-toolkit2/packages/x86_64/requirements_cp311.txt
pip install -q --no-cache-dir https://raw.githubusercontent.com/airockchip/rknn-toolkit2/master/rknn-toolkit2/packages/x86_64/rknn_toolkit2-2.5.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
cd /tmp && python -I /scripts/convert_model.py
