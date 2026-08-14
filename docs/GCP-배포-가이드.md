# GCP 배포 + 클라우드 학습 가이드

구글 클라우드(GCP)의 무료 서버에 docvault를 올리면서, 클라우드 운영의 기초를 처음부터 배우는 가이드입니다. **아무것도 모른다고 가정하고** 진행합니다.

## 이 가이드를 끝내면 배우게 되는 것

- [ ] 클라우드에서 **가상 머신(VM)**을 만들고 지우는 법
- [ ] **리전/존**이 뭔지, 왜 무료 조건에 리전이 걸려 있는지
- [ ] **SSH**로 원격 서버에 접속하는 법 (브라우저 방식 + 터미널 방식)
- [ ] 리눅스 기본 명령어 (이동·확인·편집·권한)
- [ ] 메모리가 부족한 서버에 **스왑**을 붙이는 이유와 방법
- [ ] 서버에 **Docker**를 설치하고 앱을 돌리는 법
- [ ] **VPC 방화벽**으로 포트를 열고 닫는 법
- [ ] **DNS**(도메인 → IP 연결)와 **DDNS**(IP가 바뀌어도 따라가게)의 원리
- [ ] **리버스 프록시(Caddy)**와 **HTTPS 인증서(Let's Encrypt)** 자동화
- [ ] **cron**으로 반복 작업(백업·DNS 갱신) 자동화
- [ ] 서버 간 **데이터 이사** (scp)
- [ ] 과금 사고를 막는 **예산 알림** 설정

---

# 0. 개념 먼저 잡기 (5분)

**클라우드**는 구글·아마존 같은 회사의 데이터센터 컴퓨터를 시간 단위로 빌려 쓰는 것입니다. 우리가 빌리는 단위가 **VM(가상 머신)** — 물리 서버 한 대를 소프트웨어로 잘게 쪼갠 "가상 컴퓨터" 한 칸입니다.

**리전(region)**은 데이터센터가 있는 지역(서울, 오리건, 도쿄...), **존(zone)**은 그 안의 건물 단위입니다. 리전이 멀수록 응답이 느려집니다. GCP 무료 등급은 **미국 리전 3곳에서만** 적용되기 때문에 우리는 미국 서버를 쓰게 됩니다 (한국에서 접속 시 0.15~0.2초쯤의 지연 — 문서 열람 용도로는 체감이 크지 않습니다).

**SSH**는 원격 서버의 터미널을 안전하게(암호화) 여는 표준 방법입니다. 서버에는 화면이 없으므로 모든 조작을 SSH 터미널로 합니다.

**방화벽**은 "어떤 포트로 들어오는 연결을 허용할까"의 목록입니다. GCP는 기본적으로 SSH(22)만 열려 있고 나머지는 전부 차단 — 그래서 뒤에서 우리가 필요한 포트를 직접 열게 됩니다. 이게 학습 포인트입니다.

**docvault의 구조** 복습: Docker 컨테이너 하나에 앱 전부가 들어 있고, 데이터는 `data/` 폴더 하나에 모입니다. 그래서 어떤 서버로 가든 절차는 늘 같습니다: Docker 설치 → 코드 받기 → `.env` → `docker compose up`.

---

# 1. GCP 가입과 안전장치

## 1-1. 가입

1. https://cloud.google.com/free 접속 → **무료로 시작하기**
2. 구글 계정으로 로그인 → 국가 대한민국, 약관 동의
3. 카드 등록 (본인 확인용. **직접 업그레이드하기 전까지는 자동 청구되지 않습니다**)
4. 가입하면 **$300 크레딧(90일)**을 줍니다 — 이건 보너스고, 우리가 쓸 **Always Free(무기한 무료)** 등급은 크레딧 소진·만료와 무관하게 계속 무료입니다

> **Always Free 조건 (2026 기준, 반드시 이 조합이어야 무료):**
> - VM: **e2-micro** 1대
> - 리전: **us-west1(오리건) / us-central1(아이오와) / us-east1(사우스캐롤라이나)** 중 하나
> - 디스크: **표준 영구 디스크 30GB까지**
> - 트래픽: 월 1GB 무료 (문서 열람 용도로는 충분)
> 조건을 벗어나면(서울 리전, 더 큰 VM, SSD 등) 과금됩니다.

## 1-2. 프로젝트 만들기

> 배우는 것: GCP의 리소스 구조 — 모든 것은 "프로젝트" 안에 담긴다

GCP에서는 VM·방화벽·디스크 등 모든 리소스가 **프로젝트**라는 바구니 안에 만들어집니다. 그래서 어떤 메뉴를 눌러도 "이 페이지를 보려면 프로젝트를 선택하세요"가 먼저 나옵니다.

1. 그 안내 화면의 **프로젝트 만들기** 버튼 클릭 (또는 화면 상단 바의 프로젝트 선택 드롭다운 → 새 프로젝트)
2. 프로젝트 이름: `docvault` / 위치(조직): **조직 없음** 그대로 → **만들기**
3. 만들어지면 **상단 바의 드롭다운에서 `docvault`가 선택돼 있는지 확인** — 여기가 선택돼 있어야 이후 모든 메뉴가 이 프로젝트 기준으로 동작합니다

> 💡 나중에 실험이 끝나면 프로젝트를 통째로 삭제해서 안의 모든 리소스를 한 번에 정리할 수도 있습니다 (IAM 및 관리자 → 설정 → 종료).

## 1-3. 예산 알림부터 걸기 (요금 사고 방지 — 꼭 하세요)

1. 콘솔(https://console.cloud.google.com) 좌측 ☰ → **결제(Billing)** → **예산 및 알림(Budgets & alerts)**
2. **예산 만들기** → 이름 `안전장치`, 금액 **₩5,000** 정도
3. 알림 임계값 50%·90%·100% 기본값 그대로 → 저장

이러면 어떤 이유로든 요금이 발생하기 시작할 때 이메일이 옵니다. 참고로 외부 IP 주소에 소액(월 수천 원)이 과금되는 정책 변화가 있었으니, **첫 달에 결제 화면을 한 번 열어 실제 청구가 0원인지 확인**하는 습관을 들이세요. 요금이 보이면 그때 대응하면 됩니다(이 가이드 부록 참고).

---

# 2. VM 만들기

> 배우는 것: VM 생성 옵션 읽는 법 — 머신 종류, 이미지, 디스크

1. 콘솔 ☰ → **Compute Engine → VM 인스턴스**
   - 처음이면 **"사용(Enable)"** 버튼이 나옵니다 → 클릭
   - 누르면 "Compute Engine API 제품 세부정보" 페이지로 이동하는데 **정상입니다.** 이 페이지에서는 아무것도 안 해도 됩니다 ("API 사용해 보기" 버튼이 보이면 활성화된 것)
   - 다시 ☰ → **Compute Engine → VM 인스턴스**로 들어가면 됩니다 (활성화 직후 1~2분 로딩될 수 있음)
2. **인스턴스 만들기** 클릭
3. 항목별 설정:

| 항목 | 값 | 왜? |
|---|---|---|
| 이름 | `docvault` | 아무거나 |
| 리전 | **us-west1 (오리건)** | 무료 리전 중 한국에서 제일 가까움 |
| 존 | 아무거나 (us-west1-b 등) | |
| 머신 시리즈 | **E2** ("저렴한 비용, 일상적인 컴퓨팅 처리") 라디오 선택 | |
| 머신 유형 | E2 선택 후 나타나는 드롭다운에서 **e2-micro** (vCPU 2개 공유, 1GB) | 기본값이 e2-medium(유료)인 경우가 있음 — 꼭 micro까지 내려서 선택. 무료 대상은 e2-micro뿐 |
| 프로비저닝 모델 | **표준** (기본값 그대로) | "스팟"은 싸지만 구글이 예고 없이 VM을 끌 수 있는 조건 — 상시 서버엔 부적합하고, 무료 등급도 표준에만 적용됨 |
| 부팅 디스크 → 변경 | 이미지 **Ubuntu 22.04 LTS (x86/64)**, 유형 **표준 영구 디스크**, 크기 **30GB** | SSD(균형)로 두면 과금! 표준으로 바꿀 것 |
| 방화벽 | HTTP·HTTPS 체크 **안 함** | 나중에 우리가 직접 열며 배웁니다 |

4. **만들기** → 1분쯤 후 목록에 초록불과 함께 **외부 IP**가 표시됩니다 (예: `34.83.xx.xx`). 메모해 두세요.

> 💡 존이 "리소스 부족" 오류를 내면 같은 리전의 다른 존으로 바꿔 재시도하세요.

---

# 3. SSH로 서버 접속

> 배우는 것: 원격 서버에 들어가는 두 가지 방법

## 방법 A. 브라우저 SSH (제일 쉬움 — 처음엔 이걸로)

VM 목록에서 해당 줄의 **SSH** 버튼 클릭 → 새 창에 검은 터미널이 뜨면 성공. 키 관리를 구글이 대신 해줘서 설정이 필요 없습니다.

## 방법 B. 내 PC의 PowerShell에서 (익숙해지면)

```powershell
# 1) SSH 키 생성 (최초 1회, 질문은 전부 Enter)
ssh-keygen -t ed25519

# 2) 공개키 내용 복사
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

복사한 내용을 GCP 콘솔 → Compute Engine → **메타데이터 → SSH 키 → 항목 추가**에 붙여넣고 저장. 공개키 끝부분의 `이름@PC이름`에서 **이름**이 접속 계정명이 됩니다.

```powershell
ssh 이름@34.83.xx.xx
```

> **개념**: SSH 키는 자물쇠(공개키)와 열쇠(개인키) 한 쌍입니다. 자물쇠는 서버에 걸어두고 열쇠는 내 PC에만 있습니다. 비밀번호와 달리 유출·추측이 사실상 불가능합니다. **개인키(id_ed25519) 파일은 절대 아무에게도 보내지 마세요.**

---

# 4. 리눅스 기초 다지기 (10분 실습)

> 배우는 것: 서버에서 평생 쓰게 될 기본 명령들. SSH 터미널에서 하나씩 쳐보세요.

```bash
pwd               # 지금 내가 있는 폴더 경로 (print working directory)
ls -al            # 폴더 내용 보기 (-a 숨김파일 포함, -l 자세히)
cd /              # 최상위로 이동  /  cd ~ 는 내 홈으로
df -h             # 디스크 사용량 (30GB 잘 잡혔는지 보기)
free -h           # 메모리 사용량 (1GB뿐인 것 확인)
sudo apt update   # 패키지 목록 갱신. sudo = 관리자 권한으로 실행
sudo apt upgrade -y   # 설치된 패키지 업그레이드
nano test.txt     # 텍스트 편집기 (Ctrl+O 저장, Ctrl+X 종료)
cat test.txt      # 파일 내용 출력
rm test.txt       # 파일 삭제
```

**알아둘 개념**
- `sudo`: "관리자(root) 권한으로 실행". 시스템을 건드리는 명령엔 거의 항상 붙습니다.
- `apt`: 우분투의 앱스토어 같은 것. `apt install 이름`으로 설치합니다.
- `~`(홈 디렉터리): 내 계정 전용 폴더. 우리가 받을 코드도 여기에 둡니다.

---

# 5. 스왑 추가 — 작은 서버의 필수 작업

> 배우는 것: 메모리 부족을 디스크로 버티는 스왑(swap)의 개념

e2-micro는 램이 1GB뿐이라 Docker 빌드 도중 메모리가 바닥나 **빌드가 소리 없이 죽을 수 있습니다.** 디스크 일부를 예비 메모리(스왑)로 쓰게 만들어 예방합니다:

```bash
sudo fallocate -l 2G /swapfile         # 2GB짜리 파일 생성
sudo chmod 600 /swapfile               # root만 읽고 쓰게 권한 제한
sudo mkswap /swapfile                  # 스왑 형식으로 포맷
sudo swapon /swapfile                  # 활성화
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # 재부팅 후에도 유지

free -h    # Swap 줄에 2.0Gi가 보이면 성공
```

---

# 6. Docker 설치 + docvault 실행

```bash
# Docker 공식 설치 스크립트
curl -fsSL https://get.docker.com | sudo sh

# 내 계정이 sudo 없이 docker를 쓸 수 있게 그룹에 추가
sudo usermod -aG docker $USER
exit    # 그룹 적용을 위해 나갔다가
```

다시 SSH 접속 후:

```bash
docker --version         # 버전이 나오면 성공

# 코드 받기 + 설정
git clone https://github.com/ehdwn009/docvault.git
cd docvault
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
echo "ADMIN_INITIAL_PASSWORD=초기비밀번호로바꾸세요" >> .env

# 실행 (e2-micro에선 첫 빌드가 5~10분 걸릴 수 있습니다 — 스왑 덕에 죽지 않고 완주합니다)
docker compose up -d --build

# 확인
curl http://localhost:3000/api/v1/health    # {"status":"ok",...}
```

여기까지 되면 **서버 안에서는** 돌고 있는 겁니다. 이제 밖에서 접속할 길을 뚫습니다.

---

# 7. 외부에서 접속하기

## 7-1. (학습용 워밍업) 방화벽으로 3000 포트 직접 열어보기

> 배우는 것: VPC 방화벽 규칙. HTTPS가 아니라서 확인 후 다시 닫을 겁니다.

1. 콘솔 ☰ → **VPC 네트워크 → 방화벽** → **방화벽 규칙 만들기**
2. 이름 `allow-3000-test` / 대상: **네트워크의 모든 인스턴스** / 소스 IPv4 범위: `0.0.0.0/0` (모든 곳) / 프로토콜·포트: **TCP 3000** 체크 → 만들기
3. 내 PC 브라우저에서 `http://외부IP:3000` → 로그인 화면이 보이면 성공!
4. 원리를 확인했으니 **규칙을 삭제**하세요 (목록에서 체크 → 삭제). 평문 HTTP를 전 세계에 열어두는 건 나쁜 습관입니다.

## 7-2. (본편) 무료 도메인 + 자동 HTTPS — DuckDNS + Caddy

> 배우는 것: DNS, DDNS, 리버스 프록시, TLS 인증서 자동 발급
> 결과물: `https://내이름.duckdns.org` — 돈 한 푼 안 드는 고정 HTTPS 주소

**개념 먼저**: 도메인은 "IP 주소에 붙이는 이름표"(DNS)입니다. DuckDNS는 `xxx.duckdns.org` 서브도메인을 무료로 빌려주는 서비스이고, **Caddy**는 우리 서버 앞단에서 ① 도메인으로 온 요청을 앱에 전달(리버스 프록시)하고 ② HTTPS 인증서를 Let's Encrypt에서 자동 발급·갱신해 주는 웹서버입니다.

### ① DuckDNS에서 이름 만들기

1. https://www.duckdns.org 접속 → 구글 계정으로 로그인
2. 원하는 이름 입력(예: `mydocvault`) → **add domain**
3. 방금 만든 줄의 IP 칸에 **GCP 외부 IP**를 넣고 update
4. 페이지 상단의 **token**을 복사해 두세요 (IP 자동 갱신에 씁니다)

### ② IP 자동 갱신 걸어두기 (DDNS)

GCP 외부 IP는 VM을 껐다 켜면 바뀔 수 있습니다. 5분마다 내 IP를 DuckDNS에 알려주는 스크립트를 걸어 도메인이 항상 따라오게 합니다. **서버 SSH에서**:

```bash
mkdir -p ~/duckdns
# 아래 한 줄에서 mydocvault 와 토큰을 자기 것으로 바꿔 실행
echo 'curl -s "https://www.duckdns.org/update?domains=mydocvault&token=여기에토큰&ip="' > ~/duckdns/duck.sh
chmod 700 ~/duckdns/duck.sh
~/duckdns/duck.sh; echo    # OK 가 출력되면 성공

# 5분마다 자동 실행 (cron 등록)
crontab -e     # 처음이면 1(nano) 선택
# 열린 파일 맨 아래에 다음 한 줄 추가 후 Ctrl+O, Ctrl+X:
# */5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
```

> **cron**은 리눅스의 예약 실행기입니다. `*/5 * * * *`는 "5분마다"라는 뜻 (분 시 일 월 요일).

### ③ GCP 방화벽에서 80·443 열기

7-1과 같은 방법으로 규칙 하나 생성: 이름 `allow-web`, 소스 `0.0.0.0/0`, **TCP 80, 443**.
(80은 인증서 발급·HTTP→HTTPS 리다이렉트용, 443이 실제 HTTPS 포트입니다)

### ④ Caddy 켜기

```bash
cd ~/docvault
echo "DOCVAULT_DOMAIN=mydocvault.duckdns.org" >> .env    # 자기 도메인으로
docker compose --profile edge up -d

docker compose logs caddy --tail 20   # "certificate obtained successfully" 류가 보이면 발급 완료
```

1~2분 뒤 **`https://mydocvault.duckdns.org`** 접속 → 자물쇠 아이콘과 함께 열리면 완성입니다. 폰에서도 LTE로 접속해 보고 **"홈 화면에 추가"**로 PWA 설치까지 해보세요.

## 7-3. (대안) 내 도메인을 샀다면 — Cloudflare Tunnel

도메인을 구입해 Cloudflare에 연결했다면 포트를 하나도 열지 않는 터널 방식도 있습니다: Zero Trust → Tunnels → 터널 생성 → 토큰을 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 → Public Hostname을 `HTTP` / `app:3000`으로 → `docker compose --profile tunnel up -d`. (이 경우 7-2의 방화벽 개방·Caddy는 불필요)

---

# 8. 기존 데이터 이사 (PC → GCP)

> 배우는 것: scp — SSH 위에서 파일 복사

지금까지 PC에서 쓰던 문서·계정을 그대로 옮깁니다. **PC의 PowerShell에서**:

```powershell
cd C:\Github\docvault
docker compose down                          # 일관된 상태로 스냅샷 뜨려고 잠깐 정지
tar -czf data-move.tar.gz data               # data/ 압축
scp data-move.tar.gz 계정명@GCP외부IP:~/docvault/   # 서버로 전송
```

**서버 SSH에서**:

```bash
cd ~/docvault
docker compose down
rm -rf data                       # 서버에서 갓 만든 빈 데이터 제거
tar -xzf data-move.tar.gz         # PC 데이터 복원
docker compose --profile edge up -d
```

접속해서 파일·계정이 그대로인지 확인하면 이사 끝. PC 쪽은 이제 안 띄워도 됩니다 (`docker compose down` 상태 유지).

---

# 9. 운영 루틴

```bash
cd ~/docvault
git pull && docker compose --profile edge up -d --build   # 업데이트
docker compose logs app --tail 50                          # 앱 로그
docker compose ps                                          # 상태
./scripts/backup.sh                                        # 수동 백업 → backups/

# 매일 새벽 4시 자동 백업 (crontab -e 에 추가)
0 4 * * * cd /home/계정명/docvault && ./scripts/backup.sh >> backup.log 2>&1
```

백업 파일을 서버 밖(내 PC)으로도 가끔 내려받아 두세요:

```powershell
scp 계정명@GCP외부IP:~/docvault/backups/docvault-*.tar.gz C:\백업\
```

---

# 10. 문제 해결

| 증상 | 확인·해결 |
|---|---|
| 빌드가 중간에 죽음/멈춤 | 스왑(5장) 했는지 `free -h`로 확인. 스왑 후에도 죽으면 `docker compose build` 단독 실행으로 로그 확인 |
| `https://...duckdns.org` 인증서 오류 | ① duckdns.org에서 IP가 현재 외부 IP와 같은지 ② 방화벽 80·443 열렸는지 ③ `docker compose logs caddy`의 오류 메시지 |
| 도메인 접속이 갑자기 안 됨 | VM 재시작으로 IP가 바뀐 경우 — duck.sh cron이 도는지 확인 (`crontab -l`), 수동으로 `~/duckdns/duck.sh` 실행 |
| SSH가 안 됨 | VM이 Running인지, (방법 B) 키를 메타데이터에 넣었는지. 급하면 브라우저 SSH로 |
| `permission denied` (docker) | `sudo usermod -aG docker $USER` 후 재접속했는지 |
| 요금이 청구됨 | 결제 → 보고서에서 항목 확인. 대부분 ① 리전 실수 ② 디스크가 SSD ③ 외부 IP 요금. VM 사양은 수정(중지 후 머신유형 변경)으로 바로잡을 수 있음 |
| VM을 갈아엎고 싶음 | backups/ 만 내려받고 VM 삭제 → 새로 만들어 이 가이드 5장부터 재실행 → 백업 복원 |

---

# 11. 다음에 공부하면 좋은 것들 (로드맵)

여기까지 했다면 이미 "리눅스 서버에 Docker로 서비스를 올리고 도메인·HTTPS·백업까지 운영"하는 사람입니다. 더 가보고 싶다면:

- **systemd** — 리눅스가 부팅 때 서비스를 관리하는 방식. `systemctl status docker` 부터
- **GCP 스냅샷** — 디스크 통째 백업. 콘솔에서 클릭 몇 번으로 VM 전체 복원점 생성
- **IAM** — 클라우드 권한 체계. "누가 무엇을 할 수 있나"의 표준 모델
- **gcloud CLI** — 콘솔 클릭 대신 명령어로 VM 생성·관리 (자동화의 시작)
- **Nginx vs Caddy** — 리버스 프록시 비교. 실무에선 Nginx가 표준이라 개념 비교해볼 것
- **fail2ban / SSH 포트 변경** — 서버가 받는 무차별 로그인 시도 로그(`sudo journalctl -u ssh`)를 구경해보고 방어 걸기
- **모니터링** — GCP Monitoring에서 CPU·메모리 그래프 보기, 알림 만들기
- **Terraform** — "인프라를 코드로". 오늘 클릭으로 만든 것들을 코드 한 장으로 재현하는 도구
