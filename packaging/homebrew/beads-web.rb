class BeadsWeb < Formula
  desc "Visual Kanban board and multi-project dashboard for beads task tracking"
  homepage "https://github.com/weselow/beads-web"
  version "0.11.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/weselow/beads-web/releases/download/v0.11.2/beads-web-darwin-arm64"
      sha256 "ebee1d74a8a580c1c57d205234240d3e5da364398db56a50f7dcca9f66d69e47"
    end
    on_intel do
      url "https://github.com/weselow/beads-web/releases/download/v0.11.2/beads-web-darwin-x64"
      sha256 "8e60a0f372823ff6e1be9389e59059014ca51afae68be6a9183df65c43b9a8b5"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/weselow/beads-web/releases/download/v0.11.2/beads-web-linux-x64"
      sha256 "7832f9680c10e355cae7c6058ab7fb1cbbc89b14793c9785afa588ce64b92111"
    end
  end

  def install
    bin.install Dir["beads-web-*"].first => "beads-web"
  end

  def caveats
    <<~EOS
      beads-web needs the Beads CLI (bd) on your PATH:
        https://github.com/steveyegge/beads
      Run `beads-web` and open http://localhost:3008
    EOS
  end

  test do
    assert_path_exists bin/"beads-web"
  end
end
