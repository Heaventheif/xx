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
const UserModel          = mongoose.models.User          || mongoose.model("User", UserSchema);
const GlobalDataModel    = mongoose.models.GlobalData    || mongoose.model("GlobalData", GlobalDataSchema);
const BanModel           = mongoose.models.Ban           || mongoose.model("Ban", BanSchema);
const DashboardUserModel = mongoose.models.DashboardUser || mongoose.model("DashboardUser", DashboardUserSchema);
export { UserModel, GlobalDataModel, BanModel, DashboardUserModel };
