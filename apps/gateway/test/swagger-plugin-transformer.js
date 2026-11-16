// Chạy CLI plugin @nestjs/swagger khi ts-jest biên dịch (e2e của Gateway), để schema DTO
// trong tài liệu giống hệt bản build bằng `nest build`. Option đọc thẳng từ nest-cli.json
// (project gateway) — một chỗ cấu hình duy nhất cho cả build lẫn test.
const path = require('path');
const plugin = require('@nestjs/swagger/plugin');
const nestCli = require(path.join(__dirname, '../../../nest-cli.json'));

const options =
  nestCli.projects.gateway.compilerOptions.plugins.find(
    (p) => p.name === '@nestjs/swagger',
  )?.options ?? {};

module.exports.name = 'nestjs-swagger-transformer';
// Đổi version khi đổi option để ts-jest bỏ cache biên dịch cũ
module.exports.version = 1;
module.exports.factory = (compiler) => plugin.before(options, compiler.program);
