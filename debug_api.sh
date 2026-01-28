#!/bin/bash
COOKIE_JAR="cookies.txt"
BASE_URL="http://127.0.0.1:3000"

# 1. Login
echo "Logging in..."
curl -v -c $COOKIE_JAR -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wonderpig888"}'

echo -e "\n\nCookies:"
cat $COOKIE_JAR

# 2. Fetch Config
echo -e "\n\nFetching /api/admin/config..."
curl -v -b $COOKIE_JAR "$BASE_URL/api/admin/config"

echo -e "\n\nDone."
