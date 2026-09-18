"use strict";
import mongoose from "mongoose";
const { Schema } = mongoose;
const UserSchema = new Schema(
  {
    facebookId: { type: String, required: true, unique: true, index: true },
    name:       { type: String, default: "مستخدم", trim: true },
    money:      { type: Number, default: 0, min: 0 },
    xp:         { type: Number, default: 0, min: 0 },
    level:      { type: Number, default: 1, min: 1 },
    messageCount: { type: Number, default: 0 },
    role:       { type: Number, default: 0, enum: [0, 1, 2, 3, 4] },
    banned:     { type: Boolean, default: false },
    banReason:  { type: String, default: null },
    lastSeen:   { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "users" }
);
UserSchema.methods.calculateLevel = function () {
  this.level = Math.floor(Math.sqrt(this.xp / 100)) + 1;
};
UserSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  const newLevel = Math.floor(Math.sqrt(this.xp / 100)) + 1;
  const levelUp  = newLevel > this.level;
  this.level = newLevel;
  await this.save();
  return { levelUp, newLevel };
};
const GlobalDataSchema = new Schema(
  {
    key:   { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "global_data" }
);
const BanSchema = new Schema(
  {
    type:     { type: String, required: true, enum: ["group", "user"] },
    targetID: { type: String, required: true },
    bannedBy: { type: String, default: null },
    reason:   { type: String, default: null },
  },
  { timestamps: true, collection: "bans" }
);
BanSchema.index({ type: 1, targetID: 1 }, { unique: true });
const DashboardUserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    salt:     { type: String, required: true },
    hash:     { type: String, required: true },
  },
  { timestamps: true, collection: "dashboard_users" }
);
/**
 * AppStateSchema — يخزِّن جلسة Facebook (مصفوفة الكوكيز) لكل bot.
 * مفتاح التفرُّد: botIndex (رقم الحساب).
 * يُحدَّث بـ upsert في كل مرة تُجدَّد الجلسة، لذا سيبقى دائماً سجل واحد لكل bot.
 */
const AppStateSchema = new Schema(
  {
    botIndex: { type: Number, required: true, unique: true, index: true },
    // Encrypted fcaenc2 string. The array type is retained for one-time
    // backwards-compatible reads of legacy records.
    appState: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator(value) {
          if (typeof value === "string") return value.length <= 350_000;
          return Array.isArray(value) && value.length > 0 && value.length <= 100;
        },
        message: "appState must be an encrypted payload or a bounded cookie array",
      },
    },
    savedAt:  { type: Date, default: Date.now },
    source:   { type: String, default: "runtime" }, // "runtime" | "manual" | "startup"
    cookieCount: { type: Number, min: 1, max: 100 },
    lastActivity: { type: Date, default: null },
  },
  { timestamps: true, collection: "app_states" }
);

const UserModel          = mongoose.models.User          || mongoose.model("User", UserSchema);
const GlobalDataModel    = mongoose.models.GlobalData    || mongoose.model("GlobalData", GlobalDataSchema);
const BanModel           = mongoose.models.Ban           || mongoose.model("Ban", BanSchema);
const DashboardUserModel = mongoose.models.DashboardUser || mongoose.model("DashboardUser", DashboardUserSchema);
const AppStateModel      = mongoose.models.AppState      || mongoose.model("AppState", AppStateSchema);
export { UserModel, GlobalDataModel, BanModel, DashboardUserModel, AppStateModel };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-db-schemas',
  meta: { category: 'db', path: 'src/db/schemas.js' },
  setup(_ctx) {
    // provides: BanModel, DashboardUserModel, GlobalDataModel, UserModel
  },
};
