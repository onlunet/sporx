import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const accessSecret = process.env.JWT_ACCESS_SECRET ?? "change_me_access";
    if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV === "production") {
      throw new Error("JWT_ACCESS_SECRET is required");
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessSecret
    });
  }

  async validate(payload: { sub: string; role: string; email: string }) {
    return {
      id: payload.sub,
      role: payload.role,
      email: payload.email
    };
  }
}
