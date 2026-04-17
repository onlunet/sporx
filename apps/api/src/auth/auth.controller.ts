import { AuthActorType } from "@prisma/client";
import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Request } from "express";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuthService } from "./auth.service";

type RequestUser = {
  id: string;
  role: string;
  email: string;
  sessionId?: string;
};

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsEnum(AuthActorType)
  actorType?: AuthActorType;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceFingerprint?: string;
}

class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;

  @IsOptional()
  @IsEnum(AuthActorType)
  actorType?: AuthActorType;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceFingerprint?: string;
}

class LogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;

  @IsOptional()
  @IsBoolean()
  allSessions?: boolean;
}

class RevokeSessionDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}

class CreateStepUpChallengeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}

class VerifyStepUpChallengeDto {
  @IsString()
  @MinLength(1)
  challengeId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(32)
  challengeCode!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

function parseClientIp(request: Request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? request.ip ?? "unknown";
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim() ?? request.ip ?? "unknown";
  }
  return request.ip ?? "unknown";
}

function parseBooleanQuery(value: string | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseNumberQuery(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private buildContext(request: Request, actorTypeHint?: AuthActorType, deviceFingerprint?: string) {
    const userAgentHeader = request.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
    return {
      ipAddress: parseClientIp(request),
      userAgent: userAgent ?? undefined,
      environment: process.env.NODE_ENV ?? "development",
      actorTypeHint,
      deviceFingerprint
    };
  }

  @Post("login")
  async login(@Body() body: LoginDto, @Req() request: Request) {
    return this.authService.login(
      body.email,
      body.password,
      this.buildContext(request, body.actorType, body.deviceFingerprint)
    );
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto, @Req() request: Request) {
    return this.authService.refresh(body.refreshToken, this.buildContext(request, body.actorType, body.deviceFingerprint));
  }

  @Post("logout")
  async logout(@Body() body: LogoutDto, @Req() request: Request) {
    return this.authService.logout(body.refreshToken, body.allSessions ?? false, this.buildContext(request));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Get("admin/sessions")
  async listSessions(
    @Query("userId") userId: string | undefined,
    @Query("includeRevoked") includeRevoked: string | undefined,
    @Query("limit") limit: string | undefined
  ) {
    return this.authService.listAdminSessions({
      userId: userId?.trim() || undefined,
      includeRevoked: parseBooleanQuery(includeRevoked),
      limit: parseNumberQuery(limit, 50)
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Get("admin/risk-events")
  async listRiskEvents(@Query("limit") limit: string | undefined) {
    return this.authService.listAuthRiskEvents(parseNumberQuery(limit, 100));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Get("admin/login-attempts")
  async listLoginAttempts(@Query("limit") limit: string | undefined) {
    return this.authService.listLoginAttempts(parseNumberQuery(limit, 100));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Get("admin/refresh-events")
  async listRefreshEvents(@Query("limit") limit: string | undefined) {
    return this.authService.listRefreshTokenEvents(parseNumberQuery(limit, 100));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin")
  @Post("admin/sessions/revoke")
  async revokeSession(@Body() body: RevokeSessionDto, @Req() request: Request & { user: RequestUser }) {
    return this.authService.revokeAdminSession(body.sessionId, request.user.id, body.reason);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Post("admin/step-up/challenge")
  async createStepUpChallenge(
    @Body() body: CreateStepUpChallengeDto,
    @Req() request: Request & { user: RequestUser }
  ) {
    return this.authService.createAdminStepUpChallenge(
      request.user.id,
      body.sessionId ?? request.user.sessionId,
      this.buildContext(request, AuthActorType.ADMIN),
      body.reason
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin", "admin", "analyst", "viewer")
  @Post("admin/step-up/verify")
  async verifyStepUpChallenge(
    @Body() body: VerifyStepUpChallengeDto,
    @Req() request: Request & { user: RequestUser }
  ) {
    return this.authService.verifyAdminStepUpChallenge(
      request.user.id,
      {
        challengeId: body.challengeId,
        challengeCode: body.challengeCode,
        password: body.password
      },
      this.buildContext(request, AuthActorType.ADMIN)
    );
  }
}
