import { isNativeAndroid } from "../platform";
import { nativeDatabaseCommand, type DatabaseRequest } from "../../custom/android/storage";

// Keep both native implementations behind the existing database-command boundary.
export const databaseCommand = (request: DatabaseRequest) =>
  isNativeAndroid
    ? nativeDatabaseCommand(request)
    : window.electronAPI.invoke("database-command", request);
