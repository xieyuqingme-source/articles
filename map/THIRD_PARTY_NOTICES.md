# 足迹地图的底图来源

## Natural Earth 陆地轮廓

`home/assets/map-land.json` 来自 Natural Earth 官方项目的 **1:110m Physical Land**（`ne_110m_land`），只包含陆地和主要岛屿的自然轮廓。它不包含国家、行政区、争议区域或国界图层，也不增加或改写这些边界。页面应明确称其为“陆地轮廓示意底图”，不能用于导航或判断城市边界。

- 官方项目：[Natural Earth](https://www.naturalearthdata.com/)
- 图层介绍：[1:110m Land](https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/)
- 官方代码库：[nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector)
- 固定提交：`ca96624a56bd078437bca8184e78163e5039ad19`
- 图层版本：**4.1.0**，取自该提交的 [`ne_110m_land.VERSION.txt`](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/110m_physical/ne_110m_land.VERSION.txt)
- 代码库总版本：`5.2.0-pre`。代码库版本与图层版本不同；官方图层介绍网页仍显示 4.0.0，因此此处以固定提交中的图层版本文件为准。
- 原始文件：[固定版本 GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_land.geojson)
- 获取日期：2026-10-17（UTC）
- 文件大小：138,160 字节
- SHA-256：`9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`

文件为原始 GeoJSON 的逐字节副本，只改文件名；没有再简化、裁切、取整、重投影、筛选或修改属性及地理轮廓。坐标为 WGS84 经度、纬度。它含 127 个 Polygon、128 个闭合环、5,143 个坐标点，边界范围为 `[-180, -90, 180, 83.64513]`。小比例尺数据会省略细小岛屿，不能把未绘出的地物理解为不存在。

## 公共领域与署名

Natural Earth 的[官方使用条款](https://www.naturalearthdata.com/about/terms-of-use/)及[固定提交的许可证说明](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/LICENSE.md)将其地图数据置于公共领域，允许复制、修改、电子传播及印刷，无须另行申请许可或强制署名。本站在页面来源说明中保留以下可选署名；按照用户要求，静态图片和视频画面可省略来源小字：

> Made with Natural Earth.

建议链接到 `https://www.naturalearthdata.com/`。本地 SVG / Canvas 使用同源矢量或栅格数据绘制，图像和视频导出不需要下载第三方瓦片。

## Natural Earth II 自然地理与地形

`home/assets/map-terrain.jpg` 来自 **Natural Earth II with Shaded Relief and Water**，图层 `NE2_50M_SR_W`，版本 **3.2.0**。它是全球自然地理栅格，内容为理想化土地覆盖、真实地形的阴影表达及水体，不是给简洁底图改色。图层没有国界线、行政区线、城市点或城市名称；本站也不叠加这些政治边界。它不是实时卫星影像、精确高程测量或街道导航图。

- [官方 1:50m Natural Earth II 下载介绍](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-2/)
- [官方图层说明及版本记录](https://www.naturalearthdata.com/downloads/50m-natural-earth-2/50m-natural-earth-ii-with-shaded-relief-and-water/)
- [官方公开数据托管 ZIP](https://naturalearth.s3.amazonaws.com/50m_raster/NE2_50M_SR_W.zip)
- [官方使用条款：公共领域，可修改和电子分发，无强制署名](https://www.naturalearthdata.com/about/terms-of-use/)
- 获取日期：2026-10-17（UTC）；详细尺寸、地理配准与文件摘要见 [`map-terrain.metadata.json`](map-terrain.metadata.json)。

原始 TIFF 为 10,800 × 5,400 像素。采用随下载提供的 TFW 世界文件核对其全球范围 `[-180, -90, 180, 90]`；经纬度网格的左边为西经 180 度，上边为北纬 90 度。网页资产由同一原始 TIFF 统一缩小到 6,144 × 3,072，再以 JPEG quality=90 保存（4,216,152 字节，约 4.02 MiB），没有放大插值、添加细节、锐化、裁切、改变投影、重绘海岸线、调色、移动或删除地理要素。相较上一版 4,096 × 2,048，线性分辨率提高 1.5 倍，像素数为 2.25 倍，保留的是原始来源中已有的真实地形信息。渲染通过经纬度映射、裁切、缩放和平移显示当前视野。小比例尺仍会省略细小岛屿和地形细节，放大后可能变模糊。已对比同源 8,192 × 4,096 候选图；其 JPEG 约 6.00–6.69 MiB，解码 RGBA 像素至少需 128 MiB，故默认选择 6,144 版本（至少 72 MiB），兼顾手机加载、内存和视频导出。以上内存不含浏览器表面、data URL、SVG 副本和编码缓冲；高 DPI 或插值不会增加原始地形信息。

页面运行只读取本网站的 JPEG 文件，不向 Natural Earth、第三方地图或地理编码服务发送位置或个人经历。下载的源数据留在开发工作目录；网站只需部署体积较小的派生图及来源说明。同源栅格在 SVG 导出时嵌入为 data URL，再用于 PNG / Canvas 视频导出，避免跨域污染和导出依赖在线瓦片。

## 采用本地矢量数据的取舍

本功能需要城市级足迹、浏览器内制作及图像导出，不需要街道导航。使用同源静态 GeoJSON，可以避免把地图视野或足迹记录发送给第三方地图 / 地理编码服务，也不需要 API 密钥、注册或付费服务。仅初次开发时从官方项目下载底图资产；页面运行不应访问该原始下载地址。

研究过 OpenStreetMap 标准在线瓦片的官方[使用政策](https://operations.osmfoundation.org/policies/tiles/)：其公共瓦片服务没有可用性保证，要求可见署名、正确请求标识与缓存，并禁止批量下载、预取及离线打包。为避免将可靠性和图片导出功能依赖于在线服务，本功能不调用或缓存这些瓦片。若未来需要更详细的街道底图，应另外选择条款明确允许所需导出与离线用途的服务，并在接入前重新核对许可、署名和隐私披露。

这份数据与来源说明不包含任何个人经历、私人路径或精确地址。

## 更新与核对

1. 从官方仓库选择固定提交，核对图层 `VERSION.txt` 和许可证。
2. 下载该提交下的 `geojson/ne_110m_land.geojson` 为 `home/assets/map-land.json`，保留原始字节。
3. 使用 `Get-FileHash -Algorithm SHA256 -LiteralPath home/assets/map-land.json` 计算摘要。
4. 更新本文件及 `map/map-land.metadata.json`，检查所有环闭合、经纬度范围合法，并通过页面及 PNG 导出检查。

页面投影、缩放或显示范围是渲染处理；不得为了视觉效果随意移动或增删地理要素。
