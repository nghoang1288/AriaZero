# AriaZero Workspace Rules

## Quy trình làm việc và triển khai (Workflow & Deployment Process)
1. **Kiểm thử tự động & thủ công trước khi bàn giao (Self-Test & Verification)**:
   - Sau khi hoàn thành code, Agent phải tự động kiểm thử (real test) các tính năng bằng cách chạy các script test và bắt buộc sử dụng trình duyệt (Selenium/Playwright) để truy cập và tương tác trực tiếp với giao diện.
   - Nếu phát hiện bất kỳ lỗi nào, Agent phải tự động sửa và kiểm thử lại cho tới khi hoàn toàn ổn định.
2. **Khách hàng kiểm thử (User Testing)**:
   - Sau khi Agent tự kiểm thử thành công, Agent thông báo cho người dùng (User) tiến hành kiểm thử lại các chức năng.
3. **Đẩy code lên GitHub & Docker Hub (Release & Publish)**:
   - Chỉ khi người dùng kiểm thử đạt yêu cầu và đồng ý, Agent mới tiến hành commit, push code lên GitHub và build/push lên Docker Hub.
