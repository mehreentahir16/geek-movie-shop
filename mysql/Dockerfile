FROM mysql:8.0

ENV MYSQL_ALLOW_EMPTY_PASSWORD=yes \
    MYSQL_DATABASE=cities \
    MYSQL_USER=shipping \
    MYSQL_PASSWORD=secret

# Copy configuration and initialization scripts
COPY config.sh /root/config.sh
COPY scripts/* /docker-entrypoint-initdb.d/

# Update MySQL data directory
RUN /root/config.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["mysqld"]
