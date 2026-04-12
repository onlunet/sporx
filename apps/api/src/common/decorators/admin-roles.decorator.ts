import { Roles } from "./roles.decorator";

export const AdminRoles = () => Roles("super_admin", "admin", "analyst", "viewer");
