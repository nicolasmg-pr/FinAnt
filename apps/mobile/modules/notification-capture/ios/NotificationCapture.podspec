Pod::Spec.new do |s|
  s.name           = 'NotificationCapture'
  s.version        = '1.0.0'
  s.summary        = 'FinAnt notification capture (Android-only, iOS stub).'
  s.description    = 'iOS stub of the FinAnt notification capture module. iOS has no API for reading other apps notifications; the real implementation is Android-only.'
  s.license        = 'UNLICENSED'
  s.author         = 'Nicolas Mendez'
  s.platforms      = {
    :ios => '16.4',
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
