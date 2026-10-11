import type {
    // 系列类型的定义后缀都为 SeriesOption
    BarSeriesOption,
    LineSeriesOption,
    PieSeriesOption,
} from "echarts/charts";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import type {
    DatasetComponentOption,
    GridComponentOption,
    // 组件类型的定义后缀都为 ComponentOption
    TitleComponentOption,
    TooltipComponentOption,
} from "echarts/components";
import {
    // 数据集组件
    DatasetComponent,
    GridComponent,
    LegendComponent,
    TitleComponent,
    TooltipComponent,
    // 内置数据转换器组件 (filter, sort)
    TransformComponent,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import useResize from "@/hooks/use-resize";
import { cn } from "@/utils";

// 通过 ComposeOption 来组合出一个只有必须组件和图表的 Option 类型
export type ECOption = ComposeOption<
    | BarSeriesOption
    | LineSeriesOption
    | PieSeriesOption
    | TitleComponentOption
    | TooltipComponentOption
    | GridComponentOption
    | DatasetComponentOption
>;

// 注册必须的组件
echarts.use([
    TitleComponent,
    TooltipComponent,
    GridComponent,
    DatasetComponent,
    TransformComponent,
    BarChart,
    LineChart,
    LabelLayout,
    UniversalTransition,
    CanvasRenderer,
    LegendComponent,
    PieChart,
]);

type ChartProps = {
    className?: string;
    option: ECOption;
    onClick?: (e: echarts.ECElementEvent) => boolean | void;
};

export type ChartInstance = echarts.ECharts;

const Chart = forwardRef<ChartInstance | undefined, ChartProps>(function _Chart(
    { className, option, onClick }: ChartProps,
    ref,
) {
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const chartRef = useRef<ChartInstance>(undefined);
    useLayoutEffect(() => {
        const el = element;
        if (!el) {
            return;
        }
        const chart = echarts.init(el);
        chartRef.current = chart;
        return () => {
            chart.dispose();
            chartRef.current = undefined;
        };
    }, [element]);
    useImperativeHandle(ref, () => chartRef.current);

    useEffect(() => {
        const chart = chartRef.current;
        if (!element || !chart || !onClick) return;
        chart.on("click", onClick);
        return () => {
            chart.off("click", onClick);
        };
    }, [element, onClick]);

    const resize = useCallback<Parameters<typeof useResize>[1]>((sizer) => {
        chartRef?.current?.resize(sizer());
    }, []);
    useResize(element, resize);

    useEffect(() => {
        if (!element || !chartRef.current) {
            return;
        }
        chartRef.current.setOption(option);
    }, [element, option]);
    return <div ref={setElement} className={cn(className)}></div>;
});

export default Chart;
