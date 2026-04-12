import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { UsersModule } from "../users/users.module";

const accessSecret = process.env.JWT_ACCESS_SECRET ?? "change_me_access";
if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_ACCESS_SECRET is required");
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: accessSecret,
      signOptions: { expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as any }
    })
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
