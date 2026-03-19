import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-zinc-400">
          <div className="text-lg font-medium mb-2">组件渲染出错</div>
          <div className="text-sm text-zinc-500 mb-4 max-w-md text-center">
            {this.state.error?.message || "未知错误"}
          </div>
          <button
            className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
