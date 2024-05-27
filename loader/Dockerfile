FROM python:3.8-slim

WORKDIR /loader

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libev-dev \
    libffi-dev \
    build-essential \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements.txt and install dependencies
COPY requirements.txt /loader/
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Copy the rest of the application code
COPY src/* /loader/

# Ensure entrypoint.sh is executable
RUN chmod +x /loader/entrypoint.sh

CMD ["./entrypoint.sh"]
