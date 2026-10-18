FROM php:8.4-fpm-alpine

RUN apk add --no-cache icu-libs libzip libpq oniguruma libxml2 libcurl \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev libzip-dev postgresql-dev oniguruma-dev libxml2-dev curl-dev \
 && docker-php-ext-install -j1 pdo_pgsql mbstring intl zip bcmath opcache \
 && (php -m | grep -iq '^SimpleXML$' || docker-php-ext-install -j1 simplexml) \
 && (php -m | grep -iq '^curl$' || docker-php-ext-install -j1 curl) \
 && apk del .build-deps

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /var/www/html
COPY backend/ ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader \
 && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 9000
CMD ["php-fpm"]
