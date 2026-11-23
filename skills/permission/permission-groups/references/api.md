# PIC 建群页只读接口（2026-11-23 实测）

建群页的只读接口排查记录。配置管理管家的产品建群流程通过网页弹窗查询并选择 Offering。

- 登录态：华为 SSO（浏览器登录分区已保存）；请求头 `requestType: ajax`。
- 统一响应包装：`{ message, result, statusCode }`，`statusCode: 200` 为成功。
- URL 上的 `v=时间戳` 参数可省略（仅防缓存）。
- **只收录 GET**；提交/保存类写接口不收录、不调用。

## offeringlist — 按名称搜 Offering（核心）

```
GET /prefix/Common/offeringlist?offering_name=<关键词>&only_offering=0&status_info=0,3,9
```

- 弹窗搜索框触发（输入至少 3 个关键字后查询）。`offering_name` 支持模糊匹配。
- `status_info`：状态过滤，`0,3,9` 对应弹窗默认勾选的 Active（Inactive/Disable/Obsolete 有各自编码，未逐一验证）。
- `only_offering=0`：含子形态；`1` 仅顶层（未验证）。

响应结构（实搜「Hi7501」，12 条，此处截取）：

```json
{ "message": "offering list",
  "result": [
    { "category_name": "Offering",   "id": 259883971, "offering_name": "Hi7501",      "status": "Active" },
    { "category_name": "Offering V", "id": 259883973, "offering_name": "Hi7501 V100", "status": "Active" }
  ],
  "statusCode": 200 }
```

- `category_name` 即形态前缀：`Offering` / `Offering V` / `Offering R` / `Offering C` 等（对应弹窗行首方括号）。
- 可用于排查名称、编号和形态是否对应。网页选择时按主 Skill 记录的形态优先级处理。
- 实测样例：搜「Hi7501」返回 12 条，其中 `offering_name` 恰为「Hi7501」的仅 1 条（`[Offering] Hi7501`，id=259883971）。

## offeringtree — Offering 树根节点

```
GET /prefix/Common/offeringtree?parent_id=0&status_info=0,3,9
```

- 打开 Offering 弹窗时触发。`parent_id=0` 取根（组织分类层，如 `[IRB] 重量级团队`）；逐层下钻传上一层的 `id`。

## groupType — 应用类型枚举

```
GET /prefix/admin/common_info_list?menuName=群组创建&name=groupType
```

- 返回 8 个可选值：`DBOX群组 / SVN群组 / 海思群组 / 域群组 / PDM群组 / PMS群组 / 运营商ALM群组 / JDC群组`。
- 与页面下拉一致，可用于填表前校验用户给的类型是否合法。

## groupNamePrefix — 群组名称前缀枚举

```
GET /prefix/admin/common_info_list?menuName=群组创建&name=groupNamePrefix
```

- 返回 11 个可选值：`CSI / HIS / TC / TTELab / CHEI / CRI / CMTI / RCC / APRI / SED / ERI`。
- 用户指定非默认前缀（HIS）时，可先校验是否在枚举内。
