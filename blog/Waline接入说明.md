# Waline 本地接入准备

截至2026-10-11，仅完成本地代码、模拟检查和说明。没有创建账号、授权OAuth、设置持久凭据、购买套餐、部署或Push。实际后端地址及托管商尚未确认，`waline.json`保持关闭；当前网站没有评论框、统计请求或占位的“0”。页码跳转和“谢雨聊”作者信息可以独立发布。

## 用户后续最少步骤

1. 确认后端及数据库托管商。当前[官方快速上手](https://waline.js.org/guide/get-started/)采用Vercel + Neon：由用户登录、从官方模板创建独立后端并连接Neon，再在Neon SQL Editor执行官方链接中的`waline.pgsql`建表。选套餐、地区及授权均由用户完成；本说明没有替用户选择或购买。
2. 在该后端设置下面的环境变量，并将`waline-server/index.example.cjs`中的选项合入官方模板入口`index.js`，然后重新部署后端。示例文件不能直接当成静态网站的后端运行；数据库密码和其他凭据只存托管商控制台，不放进文章仓库。设置`SERVER_URL`为真实后端地址，安全域名包含网站和后端主机名。
3. 用户访问真实后端的`/ui/register`，创建首个管理员，随后通过`/ui`审核留言。在开放给读者前，用未登录访问测试：昵称可留言、邮箱可空，新留言及回复均不会立刻公开，审核通过后才出现在评论列表及评论数中；删除后计数正确；地区、浏览器标签、第三方头像和通知均关闭。
4. 后端验收通过后，编辑`blog/waline.json`：填真实HTTPS `serverURL`、已确认的`hostingProvider`和`databaseProvider`（例如确实采用时分别填`Vercel`、`Neon`），将`backendVerified`和`enabled`都改为`true`。这两个开关只避免提前启用，不能替代后端审核或保证服务安全。重新构建，用户手动提交并Push文章仓库，现有Actions发布；Waline阶段不需要修改根主页仓库。

## 后端必需配置（尚待用户落实）

依据[官方环境变量](https://waline.js.org/reference/server/env.html)：

| 配置项 | 值／处理 | 作用 |
| --- | --- | --- |
| `COMMENT_AUDIT` | `true` | 后端先审后发，不能只靠前端提示 |
| `LOGIN` | `disable` | 不要求读者账号；前端也使用`login: 'disable'` |
| `AKISMET_KEY` | `false` | 关闭默认开启的Akismet，避免向其发送评论资料 |
| `DISABLE_REGION` | `true` | 不公开地区 |
| `DISABLE_USERAGENT` | `true` | 不公开浏览器／系统标签 |
| `DISABLE_AUTHOR_NOTIFY` | `true` | 关闭作者通知；同时不配置任何`SMTP_*`、`AUTHOR_EMAIL`或通知Webhook |
| `AVATAR_PROXY` | `false` | 关闭头像代理 |
| `GRAVATAR_STR` | `https://xieyuqingme-source.github.io/articles/assets/comment-avatar.svg` | 使用本站通用头像，不查询邮箱头像服务 |
| 后端`avatarUrl()` | 示例入口中的本站头像 | 评论头像统一指向本站；验收时也核查管理员头像 |
| `SITE_NAME` | `谢雨聊 · 谢雨卿的文章` | 网站名称 |
| `SITE_URL` | `https://xieyuqingme-source.github.io/articles/` | 网站地址 |
| `SERVER_URL` | 用户部署后得到的真实HTTPS地址 | 后端地址 |
| `secureDomains` | `xieyuqingme-source.github.io`及真实后端主机名 | 在入口文件设置；此时`SECURE_DOMAINS`环境变量不生效 |
| `IPQPS` | `60` | 保留每IP评论发布间隔 |
| PostgreSQL连接 | 在后端控制台配置真实`PG_DB`、`PG_USER`、`PG_PASSWORD`、`PG_HOST`、`PG_PORT`、`PG_SSL=true`，或官方等价`POSTGRES_*`变量 | 取所选数据库实际值，不在仓库保存凭据；不要同时填写相互冲突的别名 |

环境变量修改后必须重新部署后端。没有配置邮件发送服务，因此选填邮箱不会用于评论通知；管理员账号仍由后端管理。不要启用额外OAuth、CAPTCHA、图片搜索、第三方头像、邮件或Webhook服务。若后端模板自动带入这些配置，需要清理并验收后再打开前端开关。

## 前端行为

- 评论放在文章正文之后、公众号复制区之前；免注册、昵称必填、邮箱选填。不显示网站链接字段，不启用上传、图片表情、GIF搜索、反应按钮、TeX或外部验证码。Waline保留自身署名。
- 标题下和文章列表显示浏览次数及审核后评论数。只在接口成功返回有效非负整数时显示；超时、错误或无效响应保持隐藏，合法的真实0可显示。
- 文章标识取已有文章网址的路径，保留中文文件名的稳定对应，去掉查询参数和片段。首次启用后不要改文件名或此标识规则，否则评论与统计会分开。
- 首页和语言列表只用GET查询计数；文章页面在生产站同源时只发送一次浏览增量POST，不重试增量，避免不确定请求重复累加。本地预览只查询，不增加线上阅读量。浏览量是访问次数，不是独立读者人数，也不能追溯启用前的历史访问。
- 评论接口可用、本地客户端和样式加载成功后才展开留言区；失败隔离于正文。未配置或未验收时构建不会生成评论区、统计占位或加载脚本。删除配置或设`enabled: false`即可退回普通静态网站。
- 自托管固定版本Waline 3.16.0客户端，读者无需访问客户端CDN；暗色跟随本站主题，手机评论表单纵向排列。服务端评论内容仍由Waline处理，后端实际审核、通知和隐私设置需要实测。

## 隐私文案与待确认事项

启用时文章显示：评论和昵称会公开，邮箱选填且不公开、不用于通知；评论、昵称、邮箱（如填写）及请求中的IP和浏览器信息由所选Waline后端及托管商处理；地区和浏览器标签不公开。页面会显示配置中的真实服务及数据库托管商名称，不能将候选商写成已经使用。

列表页也说明：统计请求会向所选后端及托管商发送IP和浏览器信息。关闭展示地区／UA并不等于托管商不接收请求元数据。默认关闭阶段不发这些请求。

待确认：真实后端地址、实际托管商／数据库、后端审核和隐私验收结果。尚未做真实评论提交、管理员审核或在线计数验证，不宣称已上线。

## 本地检查与接口依据

```text
python scripts/test_build_blog.py
node scripts/test_waline_logic.mjs
python scripts/build_blog.py
```

逻辑测试使用本地模拟响应，不访问后端或提交评论。原分页的48项DOM检查保留在`work/页码跳转_20261011`。

官方依据：[客户端属性](https://waline.js.org/reference/client/props.html)、[服务端配置及头像Hook](https://waline.js.org/reference/server/config.html)、[API](https://waline.js.org/reference/server/api.html)、[计数请求源码](https://github.com/walinejs/waline/tree/main/packages/api/src)。计数查询使用官方REST接口；客户端关闭内置统计，避免重复增加浏览次数。后端示例保存在`blog/waline-server`，不会被生成器上传到`_site`。
