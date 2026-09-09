import ExpoModulesCore

/// iOS has no API for reading other apps' notifications, and never has had.
/// The module exists with the same surface so screens branch on
/// `isSupported()` rather than scattering Platform.OS checks.
internal class UnsupportedException: Exception {
  override var reason: String {
    "Notification capture is Android-only: iOS exposes no API for reading notifications."
  }
}

public class NotificationCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotificationCapture")

    Function("isSupported") { false }
    Function("isPermissionGranted") { false }
    Function("openPermissionSettings") { throw UnsupportedException() }
    Function("setAllowedPackages") { (_: [String]) in throw UnsupportedException() }
    Function("startLearning") { (_: Int) in throw UnsupportedException() }
    Function("consumeLearnedPackages") { [String]() }
  }
}
