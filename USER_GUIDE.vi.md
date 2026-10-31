# Dice Weaver — Hướng dẫn sử dụng

[🇻🇳 Tiếng Việt](USER_GUIDE.vi.md) | [🌐 English](USER_GUIDE.md) · ← Về [README](README.vi.md)

Tài liệu đầy đủ cho extension Dice Weaver: mọi tính năng, mọi setting, giải thích từng bước.

---

## Mục lục

1. [Khái niệm cốt lõi: ý định vs kết quả](#1-khái-niệm-cốt-lõi)
2. [Bắt đầu](#2-bắt-đầu)
3. [Chế độ kích hoạt roll](#3-chế-độ-kích-hoạt-roll)
4. [Luật xúc xắc](#4-luật-xúc-xắc)
5. [Bảng tham khảo Settings](#5-bảng-tham-khảo-settings)
6. [Quy tắc theo nhân vật](#6-quy-tắc-theo-nhân-vật)
7. [Trigger bắt buộc (roll theo từ khoá)](#7-trigger-bắt-buộc)
8. [Nút Roll Hub & badge](#8-nút-roll-hub--badge)
9. [Bảng điều khiển Roll Hub](#9-bảng-điều-khiển-roll-hub)
10. [Roll thủ công & lệnh /roll](#10-roll-thủ-công--lệnh-roll)
11. [Roll lại](#11-roll-lại)
12. [Dữ liệu nằm ở đâu](#12-dữ-liệu-nằm-ở-đâu)
13. [Dùng Dice Weaver với extension khác](#13-dùng-dice-weaver-với-extension-khác)
14. [Hỏi đáp & xử lý sự cố](#14-hỏi-đáp--xử-lý-sự-cố)

---

## 1. Khái niệm cốt lõi

Dice Weaver tách một lần kiểm tra dice thành hai nửa:

| Nửa | Ai làm | Là gì |
| --- | --- | --- |
| **Ý định (intent)** | AI | Một dòng ngắn: *"nhân vật X làm Y, dùng stat Z, độ khó DC"* |
| **Kết quả (outcome)** | Extension | Roll thật: `d20 + modifier (từ stat) vs DC`, áp luật crit |

AI không bao giờ nhìn thấy hay tự sinh số dice. Thẻ kết quả được chèn vào chat dưới dạng UI; marker để lại trong text là dạng tối giản `[dice:#id]` không chứa kết quả, và số liệu roll bị loại khỏi prompt history. Mặc định không gì liên quan tới roll vào context của model. Nếu bạn muốn AI *phản ứng* với kết quả, có setting opt-in ("Đưa kết quả roll vào AI") chèn vài kết quả chưa xem dưới dạng một dòng lệnh ngắn, chỉ áp dụng cho lượt kế tiếp.

## 2. Bắt đầu

1. Cài extension (xem [README](README.vi.md#cài-đặt)), reload SillyTavern.
2. Mở chat bất kỳ. Nút **Dice Weaver** hiện phía trên ô nhập tin.
3. Chơi. Khi AI làm việc gì đó không chắc chắn, nó kết thúc reply bằng một ý định roll — thẻ kết quả thật xuất hiện ngay tại chỗ.
4. Tuỳ chọn: mở ⚙ **Extensions → Dice Weaver** để đặt từ khoá trigger, đổi công thức stat, hoặc thêm quy tắc theo nhân vật.

Không cần character sheet, không cần sửa card, không cần chỉnh prompt.

## 3. Chế độ kích hoạt roll

Một setting quyết định cách AI được yêu cầu roll:

| Chế độ | Cách hoạt động | Khi nào dùng |
| --- | --- | --- |
| **Auto** (mặc định) | Dùng function tool ẩn `roll_dice` khi model/API hỗ trợ tool calling; sau số lượt bỏ lỡ đã cấu hình (**Số reply không-tool trước khi chuyển**, mặc định 3, trong nhóm *Tích hợp AI*), tự fallback về tag protocol | Hầu hết mọi trường hợp |
| **Function Call only** | Chỉ tool ẩn. Nếu model không hỗ trợ tool calling, tag fallback vẫn được bật (badge Hub báo vàng) | Muốn văn bản sạch, không tag |
| **Tag only** (tiết kiệm token) | AI kết thúc reply bằng đúng một dòng `<roll ...>`; extension parse và thay thế | Model yếu/khắt khe, muốn footprint nhỏ nhất |

Ghi chú:

- AI được nhắc bằng một directive hệ thống nhỏ; được dặn roll **tiết kiệm**, chỉ cho các nỗ lực thực sự quan trọng.
- Extension cũng nhận các dạng model hay viết nhầm: alias tool-call XML `<roll_dice ...>`, tag tự đóng, ý định bị cắt giữa dòng khi hết token — được parse hoặc cứu an toàn, không bao giờ lộ raw.
- Tin nhắn cũ còn sót tag raw được tự chữa sau khi reload trang hoặc đổi chat.

## 4. Luật xúc xắc

Một lần roll là: `natural + modifier + bonus, so với DC`.

- **Công thức stat → modifier** (mặc định `round(({stat}-50)/15)`): `{stat}` được thay bằng giá trị stat mà AI khai. Chỉ cho phép số học an toàn (`+ - * / %`, ngoặc, `round/floor/ceil/abs/min/max`) — formula lỗi trả về 0, và settings có ô xem trước trực tiếp (`stat 30 → −1 · 50 → +0 · 80 → +2`) chuyển đỏ khi formula hỏng. Formula chỉ chạy khi thật sự có stat — roll thủ công (`/roll`, Roll nhanh) **không** có modifier stat.
- **Độ khó (DC)** — mặc định 10; roll thành công khi `total ≥ DC`. AI có thể truyền số hoặc giá trị **thang tên** — `dc="easy|normal|hard|extreme"` (5/10/15/20 mặc định, sửa được trong settings).
- **Advantage / disadvantage / xúc xắc phạt** — `adv` (roll 2 lần lấy cao), `dis` (lấy thấp), cộng biến thể phạt `advp` / `disp`: roll thêm 1 viên nữa và **cộng** các viên được giữ (d20 → roll 3, giữ 2 cao nhất — hoặc thấp nhất).
- **Crit 20 / crit 1** — natural 20 luôn thành công (crit), natural 1 luôn thất bại (crit fail). Bật/tắt được. Đây là **luật d20**: chỉ áp khi kết quả được giữ là một viên d20 (`1d20` thường, hoặc `adv`/`dis` của nó). d100 ra 20, tổng `2d20`, tổng xúc xắc phạt hay công thức nhiều nhóm chỉ so với DC.
- **Công thức override** — AI (hoặc bạn, qua `/roll`) có thể truyền `1d20+3`, `2d6`, `d20-2`, cả **công thức nhiều nhóm** như `2d6+1d4+3` — mọi viên xúc xắc đều hiện trên thẻ. Formula không có dice (chỉ `3`) bị từ chối, không bị lặng lẽ biến thành d20.
- **Roll sát thương** — `kind="damage"`: không DC, luôn thành công (natural 1 vẫn crit-fail nếu bật luật); thẻ hiện nhãn **Sát thương** thay *vs DC*.
- **Tuỳ chọn nào dùng ở đâu** — xúc xắc phạt (`advp`/`disp`) và roll sát thương (`kind="damage"`) dùng được trong tag `<roll>`; xúc xắc phạt còn dùng được trong `/roll`, Roll nhanh và `DiceWeaverAPI.rollFor()`. Function tool `roll_dice` chỉ có check thường với `adv`/`dis` — ở chế độ Function Call, AI không yêu cầu được hai loại này.
- **Toán dice an toàn** — randomness đến từ `crypto.getRandomValues` với rejection sampling không lệch.

## 5. Bảng tham khảo Settings

Mở ⚙ **Extensions → Dice Weaver**. Settings chia thành 5 nhóm gập được — **Chung** (công tắc, mode, ngôn ngữ), **Luật roll** (formula, DC, thang DC, crit, roll thử), **Trigger roll bắt buộc**, **Tích hợp AI** (feed kết quả, FC fallback) và **Luật theo nhân vật**. Trạng thái mở/đóng của từng nhóm được ghi nhớ.

| Setting | Mặc định | Tác dụng |
| --- | --- | --- |
| Enable dice rolls | BẬT | Công tắc chính; tắt = không directive, không roll |
| Roll trigger mode | Auto | `Auto` / `Function Call only` / `Tag only` (mục 3) |
| Language (Ngôn ngữ) | English | Ngôn ngữ UI: English / Tiếng Việt / `Auto` (theo SillyTavern) |
| Công thức stat → modifier | `round(({stat}-50)/15)` | Template modifier; placeholder `{stat}` |
| Default DC | 10 | Dùng khi AI và lần roll đều không chỉ định |
| Thang DC (DC ladder) | 5/10/15/20 | Giá trị cho `dc="easy/normal/hard/extreme"` trong tag và tool |
| Natural 20 luôn thành công | BẬT | Luật crit (chỉ d20 đơn) |
| Natural 1 luôn thất bại | BẬT | Luật crit fail (chỉ d20 đơn) |
| Test roll | — | Xem trước thẻ với luật hiện tại |
| Từ khoá trigger | (rỗng) | Từ khoá của bạn cho trigger bắt buộc (mục 7) |
| Công thức khi trigger | (rỗng) | vd `1d20+3` — dùng cho roll bắt buộc thay công thức stat |
| Đưa kết quả roll vào AI | TẮT | Opt-in (mục 13): kết quả chưa xem được chèn làm lệnh ngắn cho **lượt kế tiếp** |
| Chuyển sang tag khi AI bỏ qua tool roll | BẬT | Chế độ Auto: sau N reply AI liên tiếp không có roll, directive tag được thêm vào để nhắc |
| Số reply không-tool trước khi chuyển | 3 | Chính là N (1–20). Có roll là reset; đổi chat hoặc bấm *Reset counter* trong Hub cũng reset |

Ô DC để **rỗng** = *"giữ nguyên giá trị cũ"* — không bao giờ bị âm thầm reset về 1.

## 6. Quy tắc theo nhân vật

Trong settings, fieldset **quy tắc riêng cho từng nhân vật** cho phép override mọi thứ cho một nhân vật (chọn từ danh sách card của bạn):

| Trường | Để rỗng nghĩa là |
| --- | --- |
| Dice cho nhân vật này | Kế thừa công tắc chính (**Tắt** = nhân vật này không bao giờ roll) |
| Đưa kết quả roll vào AI | Kế thừa setting feed chung |
| Công thức stat → modifier | Kế thừa công thức chung |
| DC mặc định | Kế thừa DC chung |
| Từ khoá trigger | Kế thừa trigger chung |
| Công thức khi trigger | Kế thừa công thức trigger chung |
| Natural 20 thành công / Natural 1 thất bại | Kế thừa luật crit chung |

Quy tắc lưu **theo card nhân vật** (key theo file avatar), nên một nhân vật giữ quy tắc riêng qua mọi chat. Bấm *Lưu quy tắc nhân vật* để lưu, *Xoá quy tắc nhân vật* để xoá. Nhân vật đã có luật được đánh dấu ● trong danh sách và có badge *có luật riêng*. Ô rỗng hiện giá trị global được kế thừa làm placeholder; ô formula có xem trước trực tiếp như ô global. Dữ liệu cũ key theo tên nhân vật vẫn được đọc tự động.

AI cũng có thể nêu tên nhân vật trong ý định roll — tên đó chọn quy tắc tương ứng và hiển thị trên thẻ (kèm avatar).

## 7. Trigger bắt buộc

Muốn roll **ngay**, không phụ thuộc "khi AI thấy hợp lý"?

1. Đặt **Từ khoá trigger** (hoặc từ khoá per-character), vd `roll`.
2. Khi tin nhắn của bạn chứa từ khoá đó, lượt trả lời kế tiếp của AI được ra lệnh — qua một directive dùng-một-lần — kết thúc bằng đúng một dòng roll **nếu** tình huống trong tin nhắn xảy ra. Từ khoá thường khớp theo **ranh giới từ** (từ khoá `roll` không khớp "scroll"); từ khoá bắt đầu bằng `/` hoặc `!` chỉ khớp ở đầu tin nhắn hoặc sau dấu câu.
3. Directive bị tiêu sau một lượt trả lời (hoặc khi generation kết thúc). Trong group chat, directive được giữ để mọi thành viên đều có thể roll.
4. **Công thức khi trigger** (tuỳ chọn) thay công thức stat cho lần roll bắt buộc đó, vd `2d6+1`.

Extension khác cũng có thể kích hoạt forced roll qua API public (mục 13).

## 8. Nút Roll Hub & badge

Nút **Dice Weaver** nằm phía trên ô nhập tin (cạnh nút Character State khi extension đó có mặt, ngược lại ở đầu send form). Trên màn hình hẹp (≤ 768 px) nút thu gọn chỉ còn icon + badge. Badge hiển thị số roll trong chat hiện tại:

- **Viền xanh** — đang bật và hoạt động.
- **Mờ** — extension đang tắt.
- **Viền vàng** — mode *Function Call only* nhưng model/API không hỗ trợ tool calling (tag fallback đang chạy).
- **Trung tính (không viền màu)** — mode *Auto* trên model/API không hỗ trợ tool calling. Không có lỗi gì: Auto chỉ đơn giản dùng tag, và roll qua tag vẫn chạy bình thường.

Bấm (hoặc Enter/Space) mở bảng điều khiển. Nút tự re-anchor khi đổi chat và reload trang.

## 9. Bảng điều khiển Roll Hub

Bấm nút để mở popup **Roll Hub**:

- **Header** — mode hiện tại đang làm gì (kèm từ khoá trigger đang bật) và chip trạng thái: bật/tắt, mode, model có hỗ trợ function calling không — kèm chip cảnh báo + nút **Reset counter** khi AI bỏ roll đủ lâu để tag fallback bật.
- **Thống kê** — số roll trong chat, **tỉ lệ thành công** (chỉ tính check — roll sát thương không có DC), số **Nat 20** và **Nat 1**, **trung bình d20** (các roll d20 đơn).
- **Roll nhanh** — nhân vật (gợi ý từ chat; để trống = nhân vật đang active), hành động (tuỳ chọn), công thức, DC (trống = DC mặc định của nhân vật), advantage. **Enter** để roll. Công thức không đọc được sẽ báo lỗi ngay tại ô và không roll. Kết quả giống `/roll` (mục 10).
- **Lịch sử roll** — ô tìm kiếm + lọc nhân vật / kết quả / nguồn và bộ đếm `lọc / tổng`. Mới nhất trước: nhân vật, kết quả (viền màu), tổng vs DC, nguồn, số tin nhắn, công thức, advantage, thời gian tương đối. **Bấm vào dòng để nhảy tới tin nhắn** (popup đóng lại, tin nhắn nháy sáng; nếu tin chưa được tải, toast nhắc dùng *Show more messages*). Mỗi dòng có **hoàn tác** (khi có kết quả cũ), **roll lại** và **xoá**. Lịch sử dài hiện 150 dòng mỗi lần kèm nút *+N*.
- **Chân trang** — *Quét lại* (vẽ lại mọi thẻ, chỉ DOM), *Xuất JSON*, và — tách riêng bên phải — *Xoá hết roll* (có confirm; text tin nhắn được giữ).
- Bảng tự cập nhật khi đang mở (roll mới, swipe, sửa tin) **mà không** mất chữ bạn đang gõ, bộ lọc đang chọn hay vị trí cuộn của danh sách.
- Đóng bằng nút / ✕ / ESC — cả ba luôn hoạt động.

## 10. Roll thủ công & lệnh /roll

Bạn có thể roll không cần AI:

```
/roll
/roll 1d20+3 dc=12 adv=adv name="Alice"
/rollhub
```

- `formula` (tuỳ chọn) — `1d20+3`, `2d6`, `d20-2`, nhiều nhóm `2d6+1d4+3`… mặc định là d20 thường.
- `dc=N` — độ khó (số, hoặc bỏ trống để dùng DC của nhân vật/global; tag của AI cũng dùng được `easy/normal/hard/extreme`).
- `adv=adv|dis|advp|disp` — advantage / disadvantage / biến thể phạt.
- `name="Char"` — tên nhân vật; áp quy tắc của nhân vật đó và ghi lên thẻ.

Kết quả gắn vào **tin AI cuối cùng** dạng thẻ; nếu chat chưa có tin AI, một dòng hệ thống nhỏ chứa roll sẽ được thêm vào. Roll thủ công **không có modifier stat** (vì không có stat) — `/roll 1d20+5` đúng là d20 + 5. Lệnh hiện toast và không trả về gì (không có gì rơi vào ô nhập). `/rollhub` mở bảng Roll Hub (mục 9).

## 11. Roll lại

Mỗi thẻ có nút **roll lại**, mỗi dòng lịch sử trong Roll Hub có nút **roll lại / hoàn tác / xoá**. Roll lại:

- Chỉ roll lại xúc xắc — modifier, bonus, DC, advantage và công thức gốc được giữ nguyên (sửa formula stat sau này không làm đổi roll cũ).
- Cập nhật thẻ tại chỗ — text tin nhắn không bị viết lại (marker chỉ chứa id roll).
- Lưu kết quả cũ thành snapshot một cấp: nút **hoàn tác** hiện ngay trên thẻ và ở dòng Hub.

### Đọc một thẻ roll

Thẻ hiện nhân vật (kèm avatar — cả persona của bạn), hành động, stat → modifier và ghi chú, **tổng** cỡ lớn kèm nhãn kết quả (*Thành công*, *Thất bại*, *Nat 20 · Chí mạng*, *Nat 1 · Thảm bại*, hoặc *Sát thương*). Dải bên dưới liệt kê **mọi viên đã roll** — viên bị loại do lợi thế/bất lợi bị gạch ngang, natural 20 / 1 được tô màu — rồi modifier, `= tổng`, `vs DC`, tag **LỢI THẾ/BẤT LỢI** và công thức.

## 12. Dữ liệu nằm ở đâu

- **Kết quả roll** — trong file lưu chat hiện tại: `extra.diceRolls` (payload, kèm bản theo swipe trong `extra.diceRollsBySwipe`).
- **Marker** — text tin nhắn giữ một marker tối giản `[dice:#id]` tại chỗ thẻ được render; đây là render hook và **không** chứa dữ liệu kết quả (kết quả chỉ nằm trong payload nên không lộ vào history của AI). Marker không có payload tương ứng sẽ bị ẩn.
- **Settings & quy tắc nhân vật** — trong extension settings của SillyTavern.
- Không ghi vào character card, không có gì rời khỏi máy bạn.

## 13. Dùng Dice Weaver với extension khác

Dice Weaver chạy độc lập, nhưng mở một **API** nhỏ cho bridge:

```
globalThis.DiceWeaverAPI
  apiVersion: 3, toolName: 'roll_dice'
  // v2 (đóng băng — bridge hiện tại dùng các hàm này)
  isEnabled(), getMode()
  getTrigger(), getTriggerFormula()      // trigger của nhân vật đang hoạt động
  hasForcedRoll(), getForcedDirective()  // directive forced-roll đang chờ
  stripMarkers(text)                     // xoá marker [dice:…] khỏi text history
  // v3 (bổ sung) — dữ liệu trả về đều là bản deep-copy, an toàn để giữ
  getRolls()                             // [{ messageId, roll }] snapshot của chat
  rollFor({ character, action, dc, formula, adv, note, stat_label, stat_value })
                                         // roll ngay qua pipeline chuẩn
  deleteRoll(id)                         // xoá một roll (thẻ + payload)
  getUnseenResults(), clearUnseenResults()  // kết quả chưa được đưa vào AI
```

Tuỳ chọn của `rollFor()`: `character` chọn quy tắc của nhân vật (trả về `null` khi dice đang tắt cho nhân vật đó, ngược lại trả về payload roll mới); `dc` là số hoặc từ trong thang DC; `adv` là `adv|dis|advp|disp`; `note` và `stat_label` (vd `"STR 3"`) hiện trên thẻ; `stat_value` chạy công thức stat → modifier — bỏ trống để roll không có modifier stat. `action` rỗng sẽ hiện là *Roll*. Roll sát thương không dùng được qua `rollFor()`.

Dice Weaver không bao giờ import hay phụ thuộc extension khác. Trong chat [Storyline](https://github.com/khangdh0202/SillyTavern-Storyline), Storyteller thay toàn bộ prompt nên function `dice_roller` của nó dùng API này để đưa hướng dẫn forced-roll và giữ marker khỏi history của AI — đây là đường tích hợp có chủ đích.

### Tuỳ chọn: đưa kết quả roll vào AI

Mặc định AI không bao giờ biết kết quả roll. Bật **Đưa kết quả roll vào AI** (global, hoặc theo nhân vật) và vài kết quả chưa xem sẽ được chèn dưới dạng một lệnh ngắn — *"những điều này đã định đoạt, tường thuật hậu quả; không bao giờ nhắc số dice"* — chỉ áp dụng cho **lượt kế tiếp**, sau đó được đánh dấu đã xem. Không có gì được ghi vào tin nhắn.

## 14. Hỏi đáp & xử lý sự cố

**AI không bao giờ roll.**
Kiểm tra extension đang bật và mode phù hợp model (Auto che phủ đa số). Model yếu có thể quên — trong Auto, directive tự chuyển sang tag protocol đòi chặt hơn sau số lượt không-tool đã cấu hình (**Số reply không-tool trước khi chuyển**, mặc định 3; chip cảnh báo kèm *Reset counter* hiện trong Roll Hub).

**Tôi thấy text raw kiểu `<roll_dice character="…" />` trong tin cũ.**
Build cũ hoặc tin được parse trước khi có fix — reload trang (F5). Sweep tự chữa parse tag sót trong tin AI cũ (từ v0.4.8).

**Thẻ hiện text marker raw kiểu `[dice:#ab12cd34 …]`.**
Nghĩa là payload bị thiếu (vd tin được copy từ chat khác). Marker không payload sẽ bị ẩn ở lần sweep kế; nút *Quét lại* trong Hub ép chạy ngay.

**Swipe làm mất thẻ roll.**
Từ v0.4.1 mỗi swipe giữ roll riêng. Nếu bạn swipe tới một vị trí swipe *mới hoàn toàn*, thì đúng là chưa có roll nào ở đó — lùi lại là có.

**DC trên thẻ sai.**
Kiểm tra quy tắc per-character (mục 6) — override của nhân vật thắng DC chung. Trường rỗng = kế thừa.

**Badge Hub màu vàng.**
Mode là *Function Call only* nhưng model/API hiện tại không hỗ trợ function calling. Chuyển sang Auto hoặc Tag only — roll vẫn chạy qua tag.

**AI có gian lận được không?**
Không. Kết quả chỉ đến từ RNG của extension; tag bịa kết quả bị strip, ý định hỏng được sửa hoặc bị chặn, và marker trong tin nhắn không chứa số. Kênh duy nhất tới model là feed kết quả opt-in (mục 13), ra lệnh cho nó tường thuật hậu quả — không bao giờ đọc số dice.

---

*Dice Weaver — ý định vào, dice ra.*
