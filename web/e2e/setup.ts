import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
export default async function setup() {
  await emulatorGoogleUser("teacher");
  await emulatorGoogleUser("student");
}
