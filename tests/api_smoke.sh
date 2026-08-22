#!/usr/bin/env bash
# ============================================================================
# API smoke tests for the Virtual Laboratory (requires a running server).
# Usage: ./tests/api_smoke.sh http://127.0.0.1:8080
# ============================================================================
set -u
BASE="${1:-http://127.0.0.1:8080}"
JAR=/tmp/vlab_cookies.txt
rm -f "$JAR"
PASS=0; FAIL=0

check() { # check <name> <expected_status> <actual_status> [extra msg]
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1 (HTTP $3)";
  else FAIL=$((FAIL+1)); echo "  ✘ $1 — expected $2, got $3 ${4:-}"; fi
}

req() { # req <method> <path> <json-body?> -> prints body, sets STATUS
  local m=$1 p=$2 b=${3:-}
  if [ -n "$b" ]; then
    BODY=$(curl -s -c "$JAR" -b "$JAR" -X "$m" -H 'Content-Type: application/json' \
      -H "X-CSRF-Token: $CSRF" -w '\n%{http_code}' "$BASE$p" -d "$b")
  else
    BODY=$(curl -s -c "$JAR" -b "$JAR" -X "$m" -H "X-CSRF-Token: $CSRF" \
      -w '\n%{http_code}' "$BASE$p")
  fi
  STATUS=$(echo "$BODY" | tail -1)
  BODY=$(echo "$BODY" | sed '$d')
}
CSRF=""

echo "== Health =="
req GET /api/health
check "health endpoint" 200 "$STATUS"

echo "== Registration =="
U="stu$(date +%s)"
req POST /api/auth/register "{\"name\":\"Test Student\",\"email\":\"$U@test.com\",\"username\":\"$U\",\"password\":\"Passw0rd\",\"enrollment\":\"ENR001\"}"
check "student registration" 201 "$STATUS"
req POST /api/auth/register "{\"name\":\"Duplicate User\",\"email\":\"$U@test.com\",\"username\":\"$U\",\"password\":\"Passw0rd\"}"
check "duplicate registration rejected" 409 "$STATUS"
req POST /api/auth/register "{\"name\":\"Y\",\"email\":\"y@test.com\",\"username\":\"yuser\",\"password\":\"short\"}"
check "weak password rejected" 400 "$STATUS"

echo "== Student login =="
req POST /api/auth/login "{\"username\":\"$U\",\"password\":\"Passw0rd\"}"
check "student login" 200 "$STATUS"
CSRF=$(echo "$BODY" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')
check "csrf token issued" 200 "$( [ -n "$CSRF" ] && echo 200 || echo 0 )"
req POST /api/auth/login '{"username":"'$U'","password":"wrongpass"}'
check "wrong password rejected" 401 "$STATUS"

echo "== Student practicals =="
req GET /api/practicals
check "student can list practicals" 200 "$STATUS"
P1=$(echo "$BODY" | sed -n 's/.*\("_id":"[a-f0-9]*"\).*/\1/p' | head -1 | sed 's/"//g;s/_id://')
[ -z "$P1" ] && P1=$(echo "$BODY" | grep -o '"practicalNumber":1' >/dev/null && echo "PRAC1")
P1=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/practicals" | grep -o '"_id":"[a-f0-9]*"' | head -1 | cut -d'"' -f4)
req GET "/api/practicals/$P1"
check "student can open a practical" 200 "$STATUS"
check "source code present in response" 200 "$( echo "$BODY" | grep -q '"sourceCode"' && echo 200 || echo 0 )"
check "simulation steps present" 200 "$( echo "$BODY" | grep -q '"steps"' && echo 200 || echo 0 )"

echo "== Progress =="
req POST /api/progress "{\"practicalId\":\"$P1\",\"step\":4,\"completed\":false}"
check "save progress" 200 "$STATUS"
req POST /api/progress "{\"practicalId\":\"$P1\",\"step\":9,\"completed\":true}"
check "complete practical" 200 "$STATUS"
req GET /api/progress
check "progress list" 200 "$STATUS"

echo "== RBAC: student cannot touch admin APIs =="
req GET /api/admin/stats
check "student blocked from admin stats" 403 "$STATUS"
req POST /api/admin/practicals "{\"title\":\"HACK\",\"practicalNumber\":99,\"sourceCode\":\"x\"}"
check "student blocked from creating practicals" 403 "$STATUS"
req PUT "/api/admin/practicals/$P1" "{\"title\":\"HACKED\",\"practicalNumber\":1,\"sourceCode\":\"evil\"}"
check "student blocked from editing practicals" 403 "$STATUS"
req DELETE "/api/admin/practicals/$P1"
check "student blocked from deleting practicals" 403 "$STATUS"
req GET /api/admin/students
check "student blocked from student management" 403 "$STATUS"

echo "== No CSRF token =="
CSRF=""
req POST /api/progress "{\"practicalId\":\"$P1\",\"step\":1}"
check "mutation without CSRF rejected" 419 "$STATUS"
CSRF=$(curl -s -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"Passw0rd\"}" "$BASE/api/auth/login" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')

echo "== Admin login + forced password change =="
rm -f "$JAR"   # fresh session (as a real admin browser would have)
req POST /api/auth/login '{"username":"admin","password":"Admin@123"}'
if [ "$STATUS" = 401 ]; then
  # password was changed by a previous test run
  req POST /api/auth/login '{"username":"admin","password":"Admin@2026"}'
  check "admin login (already-changed password)" 200 "$STATUS"
  MUSTCHANGE=false
else
  check "admin login with default password" 200 "$STATUS"
  MUSTCHANGE=$(echo "$BODY" | grep -q 'mustChangePassword":true' && echo true || echo false)
  check "mustChangePassword flag set" 200 "$( [ "$MUSTCHANGE" = true ] && echo 200 || echo 0 )"
fi
CSRF=$(echo "$BODY" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')
if [ "$MUSTCHANGE" = true ]; then
  req GET /api/admin/stats
  check "admin APIs blocked until password change" 403 "$STATUS"
  req POST /api/auth/change-password "{\"currentPassword\":\"Admin@123\",\"newPassword\":\"Admin@2026\"}"
  check "default password changed" 200 "$STATUS"
fi
req GET /api/admin/stats
check "admin stats after password change" 200 "$STATUS"
# CSRF token is unchanged by the password change — reuse it for CRUD tests.

echo "== Admin CRUD =="
req POST /api/admin/practicals "{\"practicalNumber\":99,\"title\":\"Temp Practical\",\"shortDescription\":\"temp\",\"language\":\"C\",\"sourceCode\":\"int main(){return 0;}\",\"aim\":\"a\",\"theory\":\"t\",\"simulationData\":{\"cells\":[],\"initial\":{},\"steps\":[]}}"
check "admin creates practical" 201 "$STATUS"
PID=$(echo "$BODY" | grep -o '"_id":"[a-f0-9]*"' | head -1 | cut -d'"' -f4)
req GET "/api/admin/practicals/$PID"
check "admin reads practical" 200 "$STATUS"
check "autogenerated steps present (source fallback)" 200 "$( echo "$BODY" | grep -q '"steps"' && echo 200 || echo 0 )"
req PUT "/api/admin/practicals/$PID" "{\"practicalNumber\":99,\"title\":\"Temp Practical v2\",\"language\":\"C\",\"sourceCode\":\"int main(){return 0;}\",\"simulationData\":{\"cells\":[],\"initial\":{},\"steps\":[]}}"
check "admin edits practical" 200 "$STATUS"
check "version incremented" 200 "$( echo "$BODY" | grep -q '"version":2' && echo 200 || echo 0 )"
req GET /api/admin/practicals
check "admin lists practicals" 200 "$STATUS"
req GET "/api/admin/practicals/$PID/history"
check "version history available" 200 "$STATUS"
req POST "/api/admin/practicals/$PID/restore" '{"version":1}'
check "restore version 1" 200 "$STATUS"
req DELETE "/api/admin/practicals/$PID"
check "admin deletes practical" 200 "$STATUS"

echo "== Synchronization: student sees admin changes =="
req POST /api/auth/login '{"username":"'$U'","password":"Passw0rd"}'
CSRF=$(echo "$BODY" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')
req GET /api/practicals
check "student still lists practicals after admin changes" 200 "$STATUS"

echo
echo "============================================="
echo "  PASS: $PASS   FAIL: $FAIL"
echo "============================================="
[ "$FAIL" = 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
