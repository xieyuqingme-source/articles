# Waline 接入状态与上线步骤

## 已确认与本地状态（2026-10-16）

- 稳定后端为`https://yuliao-comments.vercel.app`，服务托管为Vercel，数据库服务为Neon。用户已在Neon的`main`分支、`neondb`数据库执行官方SQL，六项CREATE成功，并自行注册首位Waline管理员；无需重复建库或注册管理员。
- 用户通过未登录管理员的无痕浏览器，用普通昵称提交“测试一下”，已直接公开显示1条评论；用户确认刷新后仍在，访客留言持久化已验证。
- 本轮只读GET `/api/comment?path=/`两次均返回HTTP 200、`errno=0`、1条`approved`评论。携带`Origin: https://xieyuqing.me`时返回`Access-Control-Allow-Origin: *`，允许当前不带凭据的跨域读取；这不等于已验证来源限制或浏览器完整联调。
- 本地`blog/waline.json`已填真实后端、`Vercel`及`Neon`，经本轮只读接口、预检及隔离启用联调验证后，按用户授权将`enabled`与`backendVerified`设为`true`，用于准备审阅与发布。本地开关开启不代表GitHub Pages线上已更新；本轮没有新增评论、增加浏览量、删除留言、操作账号、修改远端配置、提交、Push或部署网站。
- 用户自行修改设置并重新部署后，固定域名于2026-10-16 16:07 UTC的匿名GET已确认：测试留言仍在且为`approved`，IP属地非空，`browser`／`os`字段已消失，完整`ip`不返回；原始`ua`仍在JSON中。头像仍未改用本站Hook；其他反垃圾及通知配置没有读取或核验，也未写入未经核实的通知承诺。

根路径`/`的测试评论属于后端演示页面，不会自动出现在本站各篇文章下。文章仍按自己的`/articles/目录/文件名.html`标识读取评论，无需为这条测试评论更换或迁移文章标识。

## 后端最少公开配置

数据库和访客留言已经可用，不必重新填写数据库密码或重复配置连接。为固定当前接入行为，可在后端Vercel项目的Production环境核对以下非密钥项；更改后重新部署后端，本轮没有代为设置。

| 环境变量 | 目标值 | 用途 |
| --- | --- | --- |
| `COMMENT_AUDIT` | `false` | 普通访客提交成功后直接公开，无需人工预审 |
| `LOGIN` | `disable` | 不强制读者注册／登录 |
| `SITE_URL` | `https://xieyuqing.me/articles/` | 正式文章栏目 |
| `SERVER_URL` | `https://yuliao-comments.vercel.app` | 稳定服务端根地址，不附加`/api`或`/ui` |
| `SECURE_DOMAINS` | `xieyuqing.me,yuliao-comments.vercel.app` | 网站及后端来源主机名，不带协议或路径 |
| `DISABLE_USERAGENT` | `true` | 按用户选择隐藏评论区的浏览器／操作系统标签；不等于删除原始UA |

属地继续显示：`DISABLE_REGION`保持未设置，或显式填`false`，不要设为`true`。当前只为隐藏浏览器／系统标签需要新增或核对`DISABLE_USERAGENT=true`；免预审及数据库持久化已验证，不需为此重复建库或注册。标签隐藏已由用户自行部署并通过匿名GET验证，无需为本轮重复改远端。`SITE_NAME=谢雨聊 · 谢雨卿的文章`是可选显示名称；`IPQPS=60`保留默认每IP评论发布间隔，不必为接通另行修改。Neon已能持久化，现有数据库连接保持原样；`PG_SSL=true`仅在确需显式配置SSL时按现有连接方案核对，不重复创建相互冲突的`PG_*`和`POSTGRES_*`变量。实际数据库凭据只留在托管商控制台，不传入对话或网站仓库。

已核对官方npm发布包`@waline/vercel 1.43.4`：原样的字符串`false`、`FALSE`、`0`或未设置会关闭预审；解析不去除空白，带首尾空格或字面引号的`false`可能仍开启。控制台填纯`false`即可。2026-10-16 16:14 UTC，稳定后端公开响应头`X-Waline-Version`报告`1.43.4`；未读取部署锁文件，不能据此推断完整依赖树。用户的普通访客直接公开流程已经实测成功，最新匿名GET确认留言仍为`approved`、属地保留、完整IP及浏览器／系统解析字段未返回。[官方发布包](https://registry.npmjs.org/@waline/vercel/-/vercel-1.43.4.tgz)

如果未合入自定义入口，Waline会直接读取`SECURE_DOMAINS`。若合入本仓库的`index.example.cjs`，其`secureDomains`选项会覆盖原生处理，因此示例已显式解析该环境变量、去重并合入`SERVER_URL`主机名；空白列表回退到`xieyuqing.me`。两种方式都不需要另外的反向代理或新增服务。

## 已选展示范围与可选隐私示例

最终展示选择已确认：公开IP属地，隐藏浏览器／操作系统标签，完整IP不公开。用户已自行部署对应设置，匿名只读接口已确认目标展示字段；示例继续记录`DISABLE_REGION=false`和`DISABLE_USERAGENT=true`，本轮AI没有改远端。其余外部服务及头像是可选示例，仍注释保留，不把它们扩展成无条件的上线前置功能。

| 待确认选择 | 若采用该方案 | 需要验证 |
| --- | --- | --- |
| 保留IP属地（已选） | `DISABLE_REGION`未设置或`false` | 公开响应保留属地，但不包含完整`ip`字段 |
| 隐藏浏览器／系统标签（已选） | `DISABLE_USERAGENT=true` | 公开响应不生成`browser`／`os`标签；原始`ua`仍可能返回 |
| 避免向Akismet发送评论资料 | `AKISMET_KEY=false` | 后端实际采用该设置，不能只改前端提示 |
| 不发送评论通知 | `DISABLE_AUTHOR_NOTIFY=true`，并不配置邮件或通知Webhook | 只核对相关配置是否存在，不读取或展示秘密值 |
| 统一使用本站头像 | 合入示例的`avatarUrl()`，并按该方案关闭头像代理 | 本站头像返回200，访客和管理员评论均使用本站地址 |

前端文案已改为“显示IP属地，不公开完整IP；不显示浏览器和操作系统标签”，与匿名GET的字段检查一致。本地开关已按本轮验收范围开启，仍待用户审阅发布。官方代码中完整IP和原始UA仍写入数据库；非管理员公开响应删除完整`ip`，但`DISABLE_USERAGENT=true`只停止生成`browser`／`os`，不删除原始`ua`。管理员仍可获取完整IP和更详细属地；标准后台评论列表显示IP／地区，没有原始UA的专门展示栏，原始数据可通过管理员API或导出查看。不能把隐藏标签解释为公开API不再包含UA。

这些结论由官方服务端／核心源码核对，公开匿名GET还确认当前完整`ip`字段未返回；没有登录管理员账户核查线上管理API。无需为展示选择启用Neon Realtime、额外OAuth或验证码服务。数据库保存IP／UA与评论区标签显示是不同层面。

## 哪些示例需要放到后端

- `blog/waline-server/settings.env.example`只是公开配置清单，不作为文件上传或自动加载；只把用户选定的非密钥项填入现有Vercel后端的Production设置，再重新部署。
- `blog/waline-server/index.example.cjs`不是独立服务。仅在采用其固定本站头像方案或显式域名解析时，将相关逻辑和选项合入独立Waline后端的正式入口`index.js`，保留官方模板其他必要代码；无需替换整个后端仓库或新增依赖。没有采用固定头像方案时，不应声称该Hook已在云端生效。
- 固定头像Hook返回`https://xieyuqing.me/articles/assets/comment-avatar.svg`，会覆盖常规头像生成，因此不同时维护`GRAVATAR_STR`。本地统一构建即使评论关闭也复制该SVG；如果选择该方案，先确认静态网站发布后该URL返回200，再核对后端头像。仅本地构建不会改变线上头像。
- `blog/waline.json`、前端JS/CSS、vendor客户端及头像属于GitHub Pages网站，不上传到Vercel后端。后端示例和数据库凭据不进入静态发布目录。

## 本轮已通过与发布后验收

- 固定后端匿名GET确认留言、属地及隐藏标签；正式`Origin: https://xieyuqing.me`的GET可读取，评论接口OPTIONS预检返回204并允许POST及Content-Type。预检没有发送实际POST。
- 真实文章pathname的评论数及浏览次数查询返回HTTP 200、`errno=0`和有效数组；样本文章两项为真实0。根路径测试评论仍为1，不会混入文章路径。全部计数请求为GET，没有自增。
- 隔离启用页面及当前集成模块使用真实服务进行只读联调，请求层禁止非GET，使用本地预览origin避免浏览增量；组件初始化和资源、标识检查通过。这是DOM模拟及真实接口合同检查，不等于真实浏览器视觉或写入端到端验收。
- 本地两个开关已开启。用户下一步仅需审阅改动、提交并Push网站仓库，确认既有Actions的build和deploy成功。固定本站头像仍为可选替代，不要求为上线合入Hook。
- 发布后由用户查看真实文章页，并在愿意时验证一条普通访客留言的提交、直接公开及刷新持久性；生产站浏览增量在正常阅读时验证。回复、编辑、删除和管理员操作未由本轮执行，不宣称这些写入端到端流程已测试。

不把删除、额外账号、通知服务或其他增强功能扩展成上线前置项目。后台事后管理仍可使用；免预审只改变新评论公开策略，不自动处理旧的待审记录。

## 前端与文章标识

- 留言位于文章正文后；免注册，昵称必填、邮箱选填，提交成功后直接公开、无需人工预审。前端隐藏网站链接字段，不启用上传、图片表情、GIF搜索、反应按钮、TeX或外部验证码；这些前端选项不等于后端已关闭全部外部服务。
- 正文标题下及文章栏目首页、中英文列表显示浏览次数与评论数，根首页最近文章卡片未接计数。只显示有效非负整数；错误或无效响应保持隐藏，不显示假零。
- 文章标识使用生成网址的pathname，去掉域名、查询参数和片段；当前118篇标识唯一。不修改文件名、目录及`/articles/`前缀，不更换标识策略。
- 列表只GET查询；正式站正文加载时发送一次浏览增量POST且不重试。本地预览只查询、不增加线上阅读量。浏览量是访问次数，不是独立读者数，也不能追溯历史访问。客户端内置计数关闭，避免重复。
- 评论接口、客户端和样式可用后才展开组件。关闭时不生成评论区、统计标记或加载脚本，不复制Waline客户端资源；普通头像SVG仍复制且不会主动发请求。本地客户端固定为3.16.0；这不是后端版本号。

## 本地检查与统一构建

```text
python scripts/test_build_blog.py
python scripts/test_build_site.py
node scripts/test_waline_logic.mjs
python scripts/build_site.py --site-url https://xieyuqing.me
python scripts/check_site.py --site-url https://xieyuqing.me
python scripts/test_archive_pages.py
```

当前发布目录为`_site_unified/`，旧`_site/`只作对照，不直接修改生成HTML。隔离测试不修改正式配置；通过本轮可验证项后才按授权开启本地`waline.json`。根路径留言持久化、匿名字段、跨域、预检、真实只读计数与DOM模拟是已完成证据；真实浏览器文章提交、写入和生产站增量仍留待用户发布后验证，不能用只读或mock检查替代。

依据：[官方快速上手](https://waline.js.org/guide/get-started/)、[环境变量](https://waline.js.org/reference/server/env.html)、[入口配置及头像Hook](https://waline.js.org/reference/server/config.html)、[客户端属性](https://waline.js.org/reference/client/props.html)、[API](https://waline.js.org/reference/server/api.html)。日常发布见[网站与作品维护](网站与作品维护.md)。
