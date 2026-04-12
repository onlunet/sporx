import { Body, Controller, Post } from "@nestjs/common";
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { AuthService } from "./auth.service";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

class LogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;

  @IsOptional()
  @IsBoolean()
  allSessions?: boolean;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post("logout")
  async logout(@Body() body: LogoutDto) {
    return this.authService.logout(body.refreshToken, body.allSessions ?? false);
  }
}
