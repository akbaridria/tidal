import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface AdvancedCondition {
  id: string
  indicator: string
  params: Record<string, number>
  field?: string
  operator: string
  targetType: "value" | "indicator"
  targetValue?: number
  targetIndicator?: string
  targetParams?: Record<string, number>
  targetField?: string
}

export const INDICATORS = [
  { name: "RSI", params: [{ name: "period", default: 14 }], fields: ["RSI"] },
  { name: "SMA", params: [{ name: "period", default: 20 }], fields: ["SMA"] },
  { name: "EMA", params: [{ name: "period", default: 20 }], fields: ["EMA"] },
  { 
    name: "MACD", 
    params: [
      { name: "fast", default: 12 }, 
      { name: "slow", default: 26 }, 
      { name: "signal", default: 9 }
    ], 
    fields: ["MACD", "MACDs", "MACDh"] 
  },
  { 
    name: "BBANDS", 
    params: [
      { name: "period", default: 20 }, 
      { name: "std", default: 2.0 }
    ], 
    fields: ["BBU", "BBM", "BBL"] 
  },
  { name: "Price", params: [], fields: ["close", "high", "low", "open"] },
]

export const OPERATORS = [
  { label: "Less than (<)", value: "<" },
  { label: "Greater than (>)", value: ">" },
  { label: "Less than or equal (<=)", value: "<=" },
  { label: "Greater than or equal (>=)", value: ">=" },
  { label: "Crosses Above", value: "crossover" },
  { label: "Crosses Below", value: "crossunder" },
]

export function compileStrategyConfig(
  conditions: AdvancedCondition[],
  logicOperator: "AND" | "OR",
  side: "buy" | "sell"
) {
  const getTechnicalField = (indicator: string, field: string | undefined, params: Record<string, number>) => {
    if (indicator === "Price") return field || "close"
    if (!field) return undefined
    
    if (indicator === "RSI") return `RSI_${params.period}`
    if (indicator === "SMA") return `SMA_${params.period}`
    if (indicator === "EMA") return `EMA_${params.period}`
    if (indicator === "MACD") {
      const suffix = `${params.fast}_${params.slow}_${params.signal}`
      if (field === "MACD") return `MACD_${suffix}`
      if (field === "MACDs") return `MACDs_${suffix}`
      if (field === "MACDh") return `MACDh_${suffix}`
    }
    if (indicator === "BBANDS") {
      const suffix = `${params.period}_${params.std.toFixed(1)}`
      if (field === "BBU") return `BBU_${suffix}`
      if (field === "BBM") return `BBM_${suffix}`
      if (field === "BBL") return `BBL_${suffix}`
    }
    return field
  }

  const compiledConditions = conditions.map(c => {
    const rule: any = {
      operator: c.operator,
      indicator: c.indicator === "Price" ? undefined : c.indicator,
      params: c.params,
      field: getTechnicalField(c.indicator, c.field, c.params),
    }

    if (c.targetType === "value") {
      rule.compare = { value: c.targetValue }
    } else {
      rule.compare = {
        indicator: c.targetIndicator === "Price" ? undefined : c.targetIndicator,
        params: c.targetParams || {},
        field: getTechnicalField(c.targetIndicator || "Price", c.targetField, c.targetParams || {}),
      }
    }
    return rule
  })

  return {
    side,
    conditions: {
      operator: logicOperator,
      expressions: compiledConditions
    }
  }
}

interface StrategyBuilderProps {
  conditions: AdvancedCondition[]
  setConditions: React.Dispatch<React.SetStateAction<AdvancedCondition[]>>
  logicOperator: "AND" | "OR"
  setLogicOperator: (op: "AND" | "OR") => void
  side: "buy" | "sell"
  setSide: (side: "buy" | "sell") => void
}

export function StrategyBuilder({
  conditions,
  setConditions,
  logicOperator,
  setLogicOperator,
  side,
  setSide
}: StrategyBuilderProps) {

  const addCondition = () => {
    setConditions([...conditions, {
      id: Math.random().toString(),
      indicator: "RSI",
      params: { period: 14 },
      operator: "<",
      targetType: "value",
      targetValue: 50
    }])
  }

  const removeCondition = (id: string) => {
    setConditions(conditions.filter(c => c.id !== id))
  }

  const updateCondition = (index: number, updates: Partial<AdvancedCondition>) => {
    const newConds = [...conditions]
    newConds[index] = { ...newConds[index], ...updates }
    setConditions(newConds)
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
      {/* Logic Operator Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-white/50">Strategy Rules</label>
        <div className="flex rounded-lg bg-white/[0.04] p-1">
          <button
            onClick={() => setLogicOperator("AND")}
            className={`rounded-md px-3 py-1 text-[10px] font-medium transition-all ${logicOperator === "AND" ? "bg-white/10 text-[#00D4AA]" : "text-white/40"}`}
          >
            ALL MUST MATCH
          </button>
          <button
            onClick={() => setLogicOperator("OR")}
            className={`rounded-md px-3 py-1 text-[10px] font-medium transition-all ${logicOperator === "OR" ? "bg-white/10 text-[#00D4AA]" : "text-white/40"}`}
          >
            ANY CAN MATCH
          </button>
        </div>
      </div>

      {/* Conditions List */}
      <div className="flex flex-col gap-4">
        {conditions.map((cond, index) => (
          <div key={cond.id} className="group relative flex flex-col gap-4 rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
            <button
              onClick={() => removeCondition(cond.id)}
              className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-red-500/10 text-red-500 transition-all hover:bg-red-500 hover:text-white group-hover:flex"
            >
              <Trash2Icon className="size-3" />
            </button>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  value={cond.indicator}
                  onValueChange={(v) => {
                    if (v) {
                      const indicatorDef = INDICATORS.find(i => i.name === v)
                      updateCondition(index, {
                        indicator: v,
                        field: indicatorDef?.fields[0],
                        params: indicatorDef?.params.reduce((acc: any, p) => ({ ...acc, [p.name]: p.default }), {}) || {}
                      })
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder="Indicator" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATORS.map(i => <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Select
                  value={cond.operator}
                  onValueChange={(v) => v && updateCondition(index, { operator: v })}
                >
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder="Operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Params and Field for Primary Indicator */}
              <div className="flex flex-wrap items-center gap-2">
                {INDICATORS.find(i => i.name === cond.indicator)?.params.map(p => (
                  <div key={p.name} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1">
                    <span className="text-[10px] uppercase text-white/30">{p.name}</span>
                    <input
                      type="number"
                      className="w-10 bg-transparent text-[10px] font-medium text-[#00D4AA] focus:outline-none"
                      value={cond.params[p.name]}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0
                        const newParams = { ...cond.params, [p.name]: val }
                        updateCondition(index, { params: newParams })
                      }}
                    />
                  </div>
                ))}
                {INDICATORS.find(i => i.name === cond.indicator)?.fields.length! > 1 && (
                  <Select
                    value={cond.field}
                    onValueChange={(v) => v && updateCondition(index, { field: v })}
                  >
                    <SelectTrigger className="h-6 w-24 px-2 py-0 text-[10px] bg-white/[0.03] border-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INDICATORS.find(i => i.name === cond.indicator)?.fields.map(f => (
                        <SelectItem key={f} value={f} className="text-[10px]">{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-3 border-t border-white/[0.03]">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  {cond.targetType === "value" ? (
                    <Input
                      type="number"
                      placeholder="Target Value"
                      value={cond.targetValue}
                      onChange={e => updateCondition(index, { targetValue: parseFloat(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={cond.targetIndicator}
                          onValueChange={(v) => {
                            if (v) {
                              const indicatorDef = INDICATORS.find(i => i.name === v)
                              updateCondition(index, {
                                targetIndicator: v,
                                targetField: indicatorDef?.fields[0],
                                targetParams: indicatorDef?.params.reduce((acc: any, p) => ({ ...acc, [p.name]: p.default }), {}) || {}
                              })
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Compare to..." />
                          </SelectTrigger>
                          <SelectContent>
                            {INDICATORS.map(i => <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        
                        {INDICATORS.find(i => i.name === cond.targetIndicator)?.fields.length! > 1 && (
                          <Select
                            value={cond.targetField}
                            onValueChange={(v) => v && updateCondition(index, { targetField: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {INDICATORS.find(i => i.name === cond.targetIndicator)?.fields.map(f => (
                                <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {/* Params for Target Indicator */}
                      <div className="flex flex-wrap items-center gap-2">
                        {INDICATORS.find(i => i.name === cond.targetIndicator)?.params.map(p => (
                          <div key={p.name} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1">
                            <span className="text-[10px] uppercase text-white/30">{p.name}</span>
                            <input
                              type="number"
                              className="w-10 bg-transparent text-[10px] font-medium text-[#00D4AA] focus:outline-none"
                              value={cond.targetParams?.[p.name]}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                const newParams = { ...cond.targetParams, [p.name]: val }
                                updateCondition(index, { targetParams: newParams })
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const nextType = cond.targetType === "value" ? "indicator" : "value"
                    const updates: Partial<AdvancedCondition> = { targetType: nextType }
                    if (nextType === "indicator" && !cond.targetIndicator) {
                      updates.targetIndicator = "SMA"
                      updates.targetParams = { period: 20 }
                      updates.targetField = "SMA"
                    }
                    updateCondition(index, updates)
                  }}
                  className="text-[10px] text-white/30 hover:text-white"
                >
                  {cond.targetType === "value" ? "Use Indicator" : "Use Value"}
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={addCondition}
          className="h-8 border-dashed border-white/10 bg-transparent text-white/40 hover:bg-white/[0.04] hover:text-white"
        >
          <PlusIcon className="mr-2 size-3" />
          Add Rule
        </Button>
      </div>

      {/* Side Toggle (Action) */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.04]">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-white/50">Final Action</label>
          <div className="flex h-8 rounded-lg bg-white/[0.04] p-1">
            <button
              onClick={() => setSide("buy")}
              className={`rounded-md px-4 py-0 text-[10px] font-medium transition-all ${side === "buy" ? "bg-[#00D4AA] text-black" : "text-white/40"}`}
            >
              BUY
            </button>
            <button
              onClick={() => setSide("sell")}
              className={`rounded-md px-4 py-0 text-[10px] font-medium transition-all ${side === "sell" ? "bg-[#ef4444] text-white" : "text-white/40"}`}
            >
              SELL
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
