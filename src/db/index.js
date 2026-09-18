"use strict";
// قاعدة البيانات معطّلة بالكامل
export const connectDB         = async () => false;
export const disconnectDB      = async () => {};
export const flushAllAndDisconnect = async () => {};
export const saveUserData      = async () => {};
export const loadUserData      = async () => null;
export const isConnected       = () => false;
export default { connectDB, disconnectDB, flushAllAndDisconnect, isConnected };
