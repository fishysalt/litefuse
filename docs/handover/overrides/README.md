# Doris 4.0.6 compose override（handover / overrides）

## 这个文件解决什么问题

`docker-compose.dev.yml`（本地 dev 基础设施）把 Doris 的镜像钉在 **`apache/doris:fe-4.0.4` / `be-4.0.4`**，
但 **4.0.4 没有 `JSON_OBJECT_FLATTEN` 函数**，而 Litefuse 的 Doris 读路径（traces / observations / events 的
JSON 列展平）依赖它。结果是：容器起得来、能连上，但读数据的查询直接报错，整套东西不可用。

仓库根部的 `docker-compose.yml`（另一套 compose，用 `fe-4.0.6` / `be-4.0.6`）已经是正确版本，而
`docker-compose.dev.yml` 里的 4.0.4 是没跟上的遗留值。

本机（Windows 开发机）的做法是**不改仓库里的 dev compose**，而是用一个**仓库外的 override 文件**在启动时把两个
service 的 `image` 覆盖成 4.0.6：

```yaml
services:
  doris_fe:
    image: apache/doris:fe-4.0.6
  doris_be:
    image: apache/doris:be-4.0.6
```

现在这个 override 已按交接要求收进本目录，文件名 `doris-4.0.6.override.yml`。
（原始文件在仓库外的 Windows 主机上叫 `_doris406.override.yml`；实际运行的容器用的是它的一个
`%TEMP%` 临时副本，那个副本已被系统清理。详见文件顶部的 provenance 注释。）

## 本机实际是用哪几个 compose 文件起的

从**正在运行的容器标签**里读到的事实（`litefuse-doris-fe` / `litefuse-doris-be` 两者一致）：

| 项 | 值 |
|---|---|
| compose project | `litefuse-doris-dev` |
| working dir | 仓库根目录 |
| config_files（第 1 个） | `<仓库根>/docker-compose.dev.yml`（仓库内，已提交） |
| config_files（第 2 个） | `<Windows %TEMP%>/doris-4.0.6.override.yml`（仓库外临时副本，**现已不存在**） |

也就是：**`docker-compose.dev.yml` + 一个 4.0.6 的 override**，两者叠加才是本机跑起来的那套。

查看方式（PowerShell 下嵌套引号容易被吞，直接用 JSON 解析最稳）：

```powershell
(docker inspect litefuse-doris-fe | ConvertFrom-Json)[0].Config.Labels.'com.docker.compose.project.config_files'
```

macOS / Linux（POSIX shell）下可以直接用 `--format`：

```sh
docker inspect litefuse-doris-fe \
  --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

另外一个等价写法是 `docker compose ls`，或看 `docker compose config --services`。

## 在 macOS 上怎么用

> 交叉说明：`docs/handover/02-macos-deploy.md` §4.1 也讲了同一件事，但给的做法是**在仓库外重建**一份
> （`~/litefuse-dev/doris-4.0.6.override.yml`），理由是"避免污染公开仓库的工作树"。两种做法**内容完全等价**
> （都只是把两个 service 的 image 钉到 4.0.6），本目录提供的是**已归档的现成副本**，省得手抄。
> 选哪个都行，但要保持一致，别同时用两份不同的 override。这个文件不含任何敏感值，提交进仓库是安全的；
> 如果决定只放在仓库外，删掉本目录的 `.yml` 即可（保留本 README 说明来龙去脉）。

在**仓库根目录**执行（`-f` 的顺序有讲究：后面的文件覆盖前面的）：

```sh
docker compose -f docker-compose.dev.yml -f docs/handover/overrides/doris-4.0.6.override.yml up -d doris_fe doris_be
```

想把四个基础设施一起起来，就去掉 service 名：

```sh
docker compose -f docker-compose.dev.yml -f docs/handover/overrides/doris-4.0.6.override.yml up -d
```

几点注意：

- **确认覆盖生效**：`docker compose ... config | grep -A1 doris_fe` 应该看到 `image: apache/doris:fe-4.0.6`；
  起来后 `docker ps` 里两个 doris 容器的 IMAGE 也必须是 4.0.6。
- **换镜像后要重建容器**，否则 compose 可能继续用旧的：加 `--force-recreate`。数据卷不受影响（见下）。
- **首次拉起会慢**：dev compose 给 FE 的 healthcheck 配了 `start_period: 120s`、BE 是 `150s`，
  而 BE 是 `depends_on: doris_fe: condition: service_healthy`，所以前几分钟看不到 BE 是正常的。
- **`FE_SERVERS` / `BE_ADDR` 和固定网段**：dev compose 把容器 IP 写死成 `172.29.0.2` / `172.29.0.3` 并固定
  `172.29.0.0/24` 这个 bridge 网段（这些值本身就在已提交的 `docker-compose.dev.yml` 里，不是新引入的秘密）。
  如果新机器上这个网段已被占用/冲突，容器会起不来或 FE/BE 互相找不到，需要另选网段并同步改
  `FE_SERVERS` / `BE_ADDR` / `ipv4_address`。

## 与本机 `fe_custom.conf` / `be_custom.conf` 挂载的关系

这是**两个独立的问题**，override 只解决镜像版本，不碰配置挂载：

| | `docker-compose.dev.yml`（dev） | `docker-compose.yml`（仓库根另一套） |
|---|---|---|
| FE 配置挂载 | `./doris-config/fe_custom.conf → /opt/apache-doris/fe/conf/fe_custom.conf:ro` | 同样挂 `fe_custom.conf` |
| BE 配置挂载 | **没有挂 `be_custom.conf`**（只挂了 storage 卷） | 挂了 `./doris-config/be_custom.conf → /opt/apache-doris/be/conf/be_custom.conf:ro` |
| Doris 镜像 | 4.0.4（需 override 才到 4.0.6） | 4.0.6 |

也就是说：

- `doris-config/fe_custom.conf` 在 dev 路径下**有效**，随 compose 一起挂进 FE；`doris-config/be_custom.conf`
  **只在 `docker-compose.yml` 路径下有效**，走 dev compose 时它不会被挂进去（这是 dev compose 与主 compose 的
  一处真实差异，不是 override 造成的）。
- 如果 macOS 上是走 dev compose 起 Doris，而你又**需要** `be_custom.conf` 生效，得自己再叠加一个挂载覆盖，
  或者改用根部的 `docker-compose.yml`。别指望这个 4.0.6 override 顺带把 BE 配置挂上。
- 两个文件都在仓库的 `doris-config/` 里，属已提交内容，不需要另外搬运。

## 数据卷

本机当前的卷名带 compose project 前缀（`litefuse-doris-dev_...`）：

```
litefuse-doris-dev_litefuse_doris_fe_meta
litefuse-doris-dev_litefuse_doris_be_storage
litefuse-doris-dev_litefuse_postgres_data
litefuse-doris-dev_litefuse_minio_data
```

`docker-compose.dev.yml` 顶部写了 `name: litefuse-doris-dev`，所以只要在新机器上仍从这个 compose 启动，
卷名前缀一致、语义不变。**新机器上是全新的空卷**——需要重新建库/灌数据（交接档案里的 seed / probe 脚本就是
干这个的，注意其中带 LLM 的那些会消耗真实额度）。
