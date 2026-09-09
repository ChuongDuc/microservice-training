#!/bin/bash
# Script này chạy tự động khi Postgres container khởi tạo lần đầu.
# Nó đọc biến POSTGRES_MULTIPLE_DATABASES (ví dụ: "auth_db,user_db,task_db")
# và tạo từng database tương ứng.
set -e
set -u

function create_database() {
	local database=$1
	echo "  Creating database '$database'"
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
		SELECT 'CREATE DATABASE $database'
		WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
	echo "Multiple database creation requested: $POSTGRES_MULTIPLE_DATABASES"
	for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
		create_database "$db"
	done
	echo "Multiple databases created"
fi
