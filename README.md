# MDub — Thuyết minh tiếng Việt cho YouTube

Dịch phụ đề tiếng Anh của video YouTube sang tiếng Việt bằng Claude, đọc thuyết minh bằng giọng Kokoro tiếng Việt chạy offline trên máy, phát khớp thời gian video và tự giảm tiếng gốc khi đang đọc.

Created by Mondiro.

## Gồm 2 phần
- **App MDub (Windows)**: chạy ngầm ở khay hệ thống, lo dịch (Claude API), tạo giọng (Kokoro), lưu cache. Tự cập nhật từ GitHub Releases.
- **Extension Chrome**: lấy phụ đề YouTube, chèn nút **VI** vào thanh điều khiển video, phát giọng đọc. App tự cập nhật luôn extension.

## Cài đặt (1 lần)
1. Tải `MDub-Setup-x.y.z.exe` ở mục [Releases](https://github.com/satthupc00/MDub/releases) và chạy.
2. Trong app, làm 3 bước trên màn hình đầu tiên:
   1. **Tải giọng đọc** (~90 MB, tải từ Hugging Face 1 lần).
   2. **Nhập API key Claude** (console.anthropic.com → API Keys).
   3. **Cài extension Chrome**: bấm *Mở trang extension* → bật *Developer mode* → *Load unpacked* → chọn thư mục extension (bấm *Copy đường dẫn* trong app rồi dán).
3. Mở video YouTube có phụ đề tiếng Anh, bấm nút **VI**. Phím tắt **Alt+M** bật/tắt thuyết minh.

## Ghi chú kỹ thuật
- Giọng đọc: [Kokoro-Vietnamese](https://huggingface.co/contextboxai/Kokoro-Vietnamese) (Apache-2.0). App ưu tiên bản nhẹ [relingo/kokoro-vi-web](https://huggingface.co/relingo/kokoro-vi-web), dự phòng repo gốc. Chạy bằng onnxruntime-node (DirectML trên card đồ hoạ, dự phòng CPU).
- Chuyển chữ Việt sang phát âm: port JavaScript của `vig2p` (`src/main/g2p/`), dùng bảng tra sinh từ vig2p + sea-g2p (Apache-2.0) bằng `scripts/gen_lexicon.py`. Kết quả khớp bản Python (xem `tests/g2p.test.js`).
- Dịch: Claude API, dịch theo ngữ cảnh từng đoạn 60 câu, giữ thuật ngữ, giới hạn số tiếng theo thời lượng câu gốc. Câu đọc vẫn dài hơn khoảng trống thì Kokoro đọc nhanh hơn (tối đa 1,35×).
- Cache: `%APPDATA%\MDub\cache\<videoId>\` (bản dịch + file giọng đọc).
- Phát hành: tăng `version` trong `package.json` + cập nhật `whatsnew.json` → GitHub Actions tự build và tạo Release.

## Phát triển
```bash
npm install
npm start
npm test
```
