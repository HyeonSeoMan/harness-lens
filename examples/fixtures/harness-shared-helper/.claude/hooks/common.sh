# 공용 셸 헬퍼
deny() {
  echo "$1" >&2
  exit 2
}
