import CoreGraphics

/// Where the island sits on a screen. Pure values, no AppKit, so it can be tested.
struct NotchGeometry: Equatable {
    /// Full screen frame, in global screen coordinates (origin bottom-left).
    let screenFrame: CGRect
    /// Size of the hardware notch, or of the fallback anchor on screens without one.
    let notchSize: CGSize
    let hasNotch: Bool

    /// Width of the fallback anchor on screens without a notch.
    static let fallbackWidth: CGFloat = 120
    /// The fallback bar never gets taller than this, even with a tall menu bar.
    static let fallbackMaxHeight: CGFloat = 24

    /// - Parameters:
    ///   - safeAreaTop: `NSScreen.safeAreaInsets.top`, greater than 0 only on notched screens.
    ///   - auxiliaryLeftWidth / auxiliaryRightWidth: widths of `auxiliaryTopLeftArea` /
    ///     `auxiliaryTopRightArea`, the menu bar space on each side of the notch.
    ///   - menuBarHeight: height of the menu bar on this screen (used without a notch).
    init(
        screenFrame: CGRect,
        safeAreaTop: CGFloat,
        auxiliaryLeftWidth: CGFloat?,
        auxiliaryRightWidth: CGFloat?,
        menuBarHeight: CGFloat
    ) {
        self.screenFrame = screenFrame
        if safeAreaTop > 0, let left = auxiliaryLeftWidth, let right = auxiliaryRightWidth {
            let width = screenFrame.width - left - right
            if width > 0 {
                notchSize = CGSize(width: width, height: safeAreaTop)
                hasNotch = true
                return
            }
        }
        let height = min(max(menuBarHeight, 1), Self.fallbackMaxHeight)
        notchSize = CGSize(width: Self.fallbackWidth, height: height)
        hasNotch = false
    }

    /// Rect of a box of `size` hanging from the top center of the screen.
    func topCenteredRect(size: CGSize) -> CGRect {
        CGRect(
            x: screenFrame.midX - size.width / 2,
            y: screenFrame.maxY - size.height,
            width: size.width,
            height: size.height
        )
    }
}
