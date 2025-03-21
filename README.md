# Halo-Plugin-Footprint
> 基于高德地图的足迹记录Halo插件，可以记录和展示您去过的地方

> 🗺️ 记录生活轨迹，分享旅途故事 | Record life tracks, share journey stories

![Logo](https://www.lik.cc/upload/logo.svg)

## 项目介绍

`足迹` 是一个专为 Halo 2.0 博客平台开发的足迹插件。它能够帮助博主记录和展示自己的旅行足迹，让读者能够直观地了解博主去过的地方和相关故事。

## 功能特点

- 🗺️ 足迹地图展示
- 📍 支持添加地点标记
- 📝 支持为每个地点添加故事描述
- 🖼️ 支持上传地点照片
- 📅 时间线展示
- 🎨 自定义样式设置
- 📱 响应式设计，支持移动端

## 安装要求

- Halo 2.0.0 或更高版本
- Java 17 或更高版本

## 安装方式

### 方式一：应用市场安装（推荐）

1. 在 Halo 的控制台中进入应用市场
2. 搜索 `足迹`
3. 点击安装即可

### 方式二：手动安装

1. 从以下地址下载最新版本 JAR 文件：
   - GitHub Releases：[下载地址](https://github.com/acanyo/halo-plugin-footprin/releases)
2. 在 Halo 后台管理界面 -> 插件 -> 上传插件 -> 选择下载好的 JAR 文件

## 使用说明

1. 安装完成后，在 Halo 后台管理界面左侧菜单栏中找到"足迹"选项
2. 点击"添加足迹"开始记录您的旅行记录
3. 在地图上选择位置，添加相关信息：
   - 地点名称
   - 访问时间
   - 地点描述
   - 上传照片
   - 添加标签
4. 保存后即可在博客前台查看足迹展示

## 📃文档
https://www.lik.cc/docs/halo-plugins

## 主题适配
目前此插件为主题端提供了 `/footprint` 路由，模板为 `footprint.html`，也提供了 Finder API，可以将足迹列表渲染到任何地方。

## 模板变量
路由信息
* 模板路径：/templates/footprint.html
* 访问路径：/footprint

## 配置说明

### 基础配置

- 地图配置
  - 地图类型：支持多种地图源
  - 默认中心点：设置地图默认显示的中心位置
  - 默认缩放级别：设置地图默认缩放大小

- 显示设置
  - 时间线显示：开启/关闭时间线展示
  - 照片展示：设置照片展示方式
  - 标记样式：自定义地点标记的样式

### 高级配置

可在配置文件中进行更多自定义设置，包括：
- 自定义地图标记图标
- 自定义主题色
- 自定义动画效果
- API 密钥配置

## 开发指南
### 变量类型
* UrlContextListResult<[FootprintVo](#FootprintVo)>

#### 示例
```bash
<div>
  <div th:each="footprint : ${footprints.items}" th:with="spec = ${footprint.spec}">
    <a th:href="${spec.postLink}" target="_blank" th:text="${spec.title}"></a>
    <div>
      <img th:src="${spec.logo}" alt="avatar">
      <a th:href="${spec.authorUrl}" target="_blank">
        <span th:text="${spec.author}"></span>
      </a>
    </div>
  </div>
  <div th:if="${footprints.hasPrevious() || footprints.hasNext()}">
    <a th:href="@{${footprints.prevUrl}}">
      <span>上一页</span>
    </a>
    <span th:text="${footprints.page}"></span>
    <a th:href="@{${footprints.nextUrl}}">
      <span>下一页</span>
    </a>
  </div>
</div>
```

## Finder API

### listAll()

#### 描述
获取全部订阅文章内容。

#### 参数
无

#### 返回值
List<[FootprintVo](#FootprintVo)>

#### 示例

```bash
<div>
  <div th:each="footprint : ${footprintFinder.listAll()}" th:with="spec = ${footprint.spec}">
    <a th:href="${spec.postLink}" target="_blank" th:text="${spec.title}"></a>
    <div >
      <img th:src="${spec.logo}" alt="avatar">
      <a th:href="${spec.authorUrl}" target="_blank">
        <span th:text="${spec.author}"></span>
      </a>
    </div>
  </div>
</div>
```

### list(page, size)

#### 描述
根据分页参数获取订阅文章内容。

#### 参数
* page: int - 分页页码，从 1 开始
* size: int - 分页条数

#### 返回值
[ListResult<FootprintVo>](#FootprintVo)

#### 示例

```bash
<th:block th:with="footprints = ${footprintFinder.list(1, 10)}">
    <div>
      <div th:each="footprint : ${footprints.items}" th:with="spec = ${footprint.spec}">
        <a th:href="${spec.postLink}" target="_blank" th:text="${spec.title}"></a>
        <div >
          <img th:src="${spec.logo}" alt="avatar">
          <a th:href="${spec.authorUrl}" target="_blank">
            <span th:text="${spec.author}"></span>
          </a>
        </div>
      </div>
    </div>
    <div>
      <span th:text="${footprints.page}"></span>
    </div>
</th:block>
```

## 类型定义
### FootprintVo
```bash
{
  "metadata": {
    "name": "string",                                         // 唯一标识
    "generateName": "string",
    "version": 0,
    "creationTimestamp": "2024-01-16T16:13:17.925131783Z",    // 创建时间
  },
  "apiVersion": "footprint.lik.cc/v1alpha1",
  "kind": "Footprint",
  "spec": {
   {
    "name": "string",                                        // 足迹名称
    "description": "string",                                 // 足迹描述
    "longitude": "double",                                   // 经度
    "latitude": "double",                                    // 纬度
    "address": "string",                                     // 地址
    "footprintType": "string",                               // 足迹类型
    "image": "string",                                       // 足迹图片URL
    "article": "string",                                     // 管理文章URL
    "createTime": "instant"                                  // 创建时间
    }
  }
}
```

### ListResult

```bash
{
  "page": 0,                                   // 当前页码
  "size": 0,                                   // 每页条数
  "total": 0,                                  // 总条数
  "items": "List<#FootprintVo>",              // 列表数据
  "first": true,                               // 是否为第一页
  "last": true,                                // 是否为最后一页
  "hasNext": true,                             // 是否有下一页
  "hasPrevious": true,                         // 是否有上一页
  "totalPages": 0                              // 总页数
}
```

### UrlContextListResult

```bash
{
  "page": 0,                                   // 当前页码
  "size": 0,                                   // 每页条数
  "total": 0,                                  // 总条数
  "items": "List<#FootprintVo>",              // 列表数据
  "first": true,                               // 是否为第一页
  "last": true,                                // 是否为最后一页
  "hasNext": true,                             // 是否有下一页
  "hasPrevious": true,                         // 是否有上一页
  "totalPages": 0,                             // 总页数
  "prevUrl": "string",                         // 上一页链接
  "nextUrl": "string"                          // 下一页链接
}
```
### 环境准备

```bash
# 克隆项目
git clone https://github.com/your-repo/halo-plugin-footprint.git

# 进入项目目录
cd halo-plugin-footprint

# 安装依赖
./gradlew build

# 打包
./gradlew clean build
```

## 问题反馈

如果您在使用过程中遇到任何问题，或有任何建议，欢迎通过以下方式反馈：

1. [GitHub Issues](https://github.com/your-repo/halo-plugin-footprint/issues)
2. [Halo 社区](https://bbs.halo.run)

## 贡献指南

我们非常欢迎各种形式的贡献，包括但不限于：

- 提交问题和建议
- 提交代码改进
- 完善文档
- 分享使用经验

在提交贡献之前，请先阅读我们的贡献指南。

## 许可证

本项目采用 [GPL-3.0 License](./LICENSE) 开源协议。

## 鸣谢

感谢所有贡献者对本项目的支持！

样式设计参考:困困鱼 & Thyuu