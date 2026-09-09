// expo-router's own entry, plus the headless task registration it cannot host.
// A task registered inside app/_layout.tsx never evaluates on a headless
// launch, because expo-router requires the app/ tree lazily.
import 'expo-router/entry';
import './src/notifications/headless-task';
