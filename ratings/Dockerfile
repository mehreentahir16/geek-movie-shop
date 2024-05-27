# Use composer to install dependencies
FROM composer:2.1 AS build

COPY composer.json /app/

RUN composer install

# Build the app
FROM php:7.4-apache

RUN docker-php-ext-install pdo_mysql

# Relax permissions on status
COPY status.conf /etc/apache2/mods-available/status.conf
# Enable Apache mod_rewrite and status
RUN a2enmod rewrite && a2enmod status

WORKDIR /var/www/html

# Copy dependencies from previous step
COPY --from=build /app/vendor/ /var/www/html/vendor/

# Copy application
COPY html/ /var/www/html

# Copy custom entrypoint
COPY docker-php-entrypoint.sh /usr/local/bin/docker-php-entrypoint
RUN chmod +x /usr/local/bin/docker-php-entrypoint

# Install New Relic PHP agent
RUN apt-get update -y && \
    apt-get install -y gnupg wget tar jq lsb-release ca-certificates && \
    wget -qO - https://download.newrelic.com/548C16BF.gpg | apt-key add - && \
    echo "deb http://apt.newrelic.com/debian/ newrelic non-free" | tee /etc/apt/sources.list.d/newrelic.list && \
    apt-get update -y && \
    # Fetch the latest version of the New Relic PHP agent
    LATEST_VERSION=$(curl -s https://download.newrelic.com/php_agent/release/ | grep -oP 'newrelic-php5-\K[0-9.]+(?=-linux.tar.gz)' | sort -V | tail -n 1) && \
    echo "Latest New Relic PHP Agent Version: ${LATEST_VERSION}" && \
    if [ -z "$LATEST_VERSION" ]; then echo "Failed to fetch the latest version."; exit 1; fi && \
    wget "https://download.newrelic.com/php_agent/release/newrelic-php5-${LATEST_VERSION}-linux.tar.gz" && \
    tar -xzf "newrelic-php5-${LATEST_VERSION}-linux.tar.gz" && \
    rm -f "newrelic-php5-${LATEST_VERSION}-linux.tar.gz" && \
    NR_INSTALL_USE_CP_NOT_LN=1 ./newrelic-php5-${LATEST_VERSION}-linux/newrelic-install install && \
    rm -rf "newrelic-php5-${LATEST_VERSION}-linux"

COPY newrelic.ini /usr/local/etc/php/conf.d
