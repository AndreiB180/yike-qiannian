# 一刻千年

把一张照片刻成一块云冈砂岩浮雕，放进北魏圆拱龛。可以换光（太阳、火把、手电）、拖时间轴看它从 483 年风化到 2526 年、在旁边的石碑上写下名字刻进去、拍墨拓一张拓片带走。

在线体验：<https://andreib180.github.io/yike-qiannian/>（电脑上的 Chrome 或 Edge，要支持 WebGL2）

北京大学《图像处理》2026 课程大作业（主题：石刻浮雕创作），孙海铭、马达。这里是网页舞台的静态版：照片到浮雕的几何（深度、法线、梯度域重建）在本地 Python 服务里算，不在这个仓库里，所以网上只能看已经刻好的 16 件，不能现拍。

## 作品

- `lead`：作者孙海铭本人的照片刻的，打开页面默认是它。只用于展示这个作业，请勿另作他用。
- `t01`–`t15`：Wikimedia Commons 上 CC0 或公有领域的人像照片刻的，来源见下表。
- 1907 年的老照片：沙畹（Édouard Chavannes）摄，公有领域，[来源](https://commons.wikimedia.org/wiki/File:Yungang_Grottoes_1907.jpg)。

| 编号 | 照片 | 作者 | 许可 |
|---|---|---|---|
| t01 | [Always smile (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Always_smile_(Unsplash).jpg) | michael m_minimal | CC0 |
| t02 | [Smiling woman pink shirt.jpg](https://commons.wikimedia.org/wiki/File:Smiling_woman_pink_shirt.jpg) | Joshua McKnight | CC0 |
| t03 | [Business Professional (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Business_Professional_(Unsplash).jpg) | Heng Films hengfilms | CC0 |
| t04 | [Karen Elder (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Karen_Elder_(Unsplash).jpg) | Capturing the human heart. zjtcpts | CC0 |
| t05 | [Man with wrinkles and cap (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Man_with_wrinkles_and_cap_(Unsplash).jpg) | Kahar Saidyhalam kahar | CC0 |
| t06 | [Daring (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Daring_(Unsplash).jpg) | Alex Lambley alexscottlambley | CC0 |
| t07 | [Pixie Cut (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Pixie_Cut_(Unsplash).jpg) | Janko Ferlič thepootphotographer | CC0 |
| t08 | [Face portrait (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Face_portrait_(Unsplash).jpg) | William Stitt willpower | CC0 |
| t09 | [Nose Ring and Glasses (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Nose_Ring_and_Glasses_(Unsplash).jpg) | Sebastian Unrau sebastian_unrau | CC0 |
| t10 | [Friends show off engagement ring (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Friends_show_off_engagement_ring_(Unsplash).jpg) | Colin Maynard invent | CC0 |
| t11 | [Friends 1 (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Friends_1_(Unsplash).jpg) | Joel Mwakasege joelmwakasege | CC0 |
| t12 | [Curly hair and freckles man (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Curly_hair_and_freckles_man_(Unsplash).jpg) | Jeremy Bishop tidesinourveins | CC0 |
| t13 | [Man looking at booklets.jpg](https://commons.wikimedia.org/wiki/File:Man_looking_at_booklets.jpg) | Bill Branson (photographer) | Public domain |
| t14 | [Portrait of Paul, Okon Antai.jpg](https://commons.wikimedia.org/wiki/File:Portrait_of_Paul,_Okon_Antai.jpg) | Paul The Writer | CC0 |
| t15 | [Woman smiling.png](https://commons.wikimedia.org/wiki/File:Woman_smiling.png) | Mahesk | CC0 |

## 页面

- `index.html`：舞台。右边面板换作品、石材、刻法；左边换光，在画面上拖动移光；底下拖时间轴；“题名”在石碑上写名字，“拓”拍墨拓片，“执灯”用摄像头跟踪真手电（要允许摄像头）。
- `test.html`：用户测试（约 10 分钟）。只记选择、用时和打分，不拍照、不记名字；最后给一段结果码。
- `write.html`、`rub.html`：现场展示时平板用的题名页和拓包页，要配本地服务。

代码和素材只供课程评阅和展示。
